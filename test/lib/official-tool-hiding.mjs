/** Real host mount checks, also run before the legacy mount suite's runtime gate. */
import { createScope } from '@deepseek-ai/dsh-scope'
import { apply } from '../../lib/official-tool-hiding.js'
import { platformSurface } from '../../lib/official-tool-catalog.js'
import { FILE_TOOLS, publicToolName } from '../../lib/policy.js'
import { assert, test, waitFor } from './harness.mjs'
import { bootHost, registryHasOwnRegister, registryNames, scopedToolNames, shutdown } from './host.mjs'

/**
 * The exact 48 tools a stock desktop session reported in #207 as "no registered
 * equivalent OPS capability". It is the deterministic input for the regression:
 * `write` and `edit` are inside the file face, the other 46 are host
 * capabilities the component never takes over. Frozen so a future edit cannot
 * quietly change the fixture the issue was filed against.
 */
export const STOCK_UNSUPPORTED_48 = Object.freeze([
  'terminal_open', 'terminal_send', 'terminal_read', 'terminal_signal', 'terminal_close', 'terminal_list',
  'session_search', 'session_event_search', 'session_trace', 'session_event_trace', 'session_event_read',
  'list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource',
  'ralph', 'load_workspace_dependencies', 'write', 'edit',
  'job_output', 'job_list', 'job_kill', 'skill', 'web_search', 'web_fetch', 'present', 'read_image',
  'send_message', 'interrupt_agent', 'list_agents', 'workflow', 'todo_write',
  'get_goal', 'create_goal', 'update_goal', 'ask_user_question', 'exit_plan_mode',
  'subagent_fork', 'schedule_create', 'schedule_list', 'schedule_delete', 'schedule_update',
  'subagent', 'spawn_teammate', 'wait_agent',
  'team_task_create', 'team_task_list', 'team_task_get', 'team_task_update',
])

const tool = name => ({ name, description: `fixture ${name}`, parameters: { type: 'object', properties: {} },
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => `ran:${name}` })
async function mint(ctx, id, parent) {
  const agent = { id, session: { id, header: { cwd: process.cwd() } } }
  await (parent?.ctx ?? ctx).plugin({ inject: ['tools', 'systemPrompt'], apply(inner) {
    agent.ctx = createScope(inner, agent, parent ? { parent } : undefined).ctx
  } })
  await ctx.serial('agent/created', { agent })
  return agent
}
async function mount(ctx, config = {}) {
  const fiber = await ctx.plugin({ name: 'fixture-strict-hide', apply }, config)
  // Injected fibers activate after the owning component's mount resolves.
  await new Promise(resolve => setImmediate(resolve))
  return fiber
}
/** Capture host warnings without touching the registry or the real logger sink. */
function warningsFrom(ctx) {
  const warnings = []
  ctx.logger.exporter({
    levels: { default: 4 },
    export(message) { if (message.type === 'warn') warnings.push(message.args.join(' ')) },
  })
  return warnings
}
function replacements(ctx) { return FILE_TOOLS.map(name => ctx.tools.register(tool(publicToolName(name)))) }
const assemble = (ctx, agent) => ctx.get('systemPrompt').assemble({ scope: agent })
const execute = (ctx, agent, name) => ctx.get('tools').execute({ agent, name, arguments: {}, callId: 'hide-test', signal: new AbortController().signal })

export async function officialToolHidingMountChecks() {
  await test('strict hiding removes official schemas and dispatch, preserves unrelated scopes, and lifts on unload', async () => {
    const { ctx } = await bootHost()
    try {
      replacements(ctx)
      const retained = platformSurface().retainedCommand
      for (const name of ['read', 'glob', 'grep', retained, 'foreign']) ctx.tools.register(tool(name))
      const existing = await mint(ctx, 'existing-hide-agent')
      await ctx.plugin(inner => inner.provide('agents', { list: () => [existing] }))
      const hiding = await mount(ctx)
      const current = await mint(ctx, 'new-hide-agent')
      for (const agent of [existing, current]) {
        const names = scopedToolNames(ctx, agent)
        for (const name of ['read', 'glob', 'grep']) {
          assert.equal(names.includes(name), false)
          assert.equal(ctx.tools.get(name, agent), undefined)
          assert.ok(registryNames(ctx).includes(name))
        }
        assert.ok(names.includes(retained)); assert.ok(names.includes('foreign'))
        const assembly = await assemble(ctx, agent)
        assert.deepEqual(assembly.tools.map(s => s.name).sort(), names)
      }
      assert.equal(registryHasOwnRegister(ctx), false)
      for (const api of ['restrict', 'guard', 'schemas', 'get']) assert.equal(Object.hasOwn(ctx.get('tools'), api), false)
      const first = await mint(ctx, 'foreign-scope-one'), second = await mint(ctx, 'foreign-scope-two')
      for (const agent of [first, second]) agent.ctx.tools.register(tool('foreign-local'))
      assert.equal(registryNames(ctx).includes('foreign-local'), false)
      assert.ok((await execute(ctx, current, 'read')).isError)
      assert.equal((await execute(ctx, current, 'foreign')).isError, false)
      await hiding.dispose()
      assert.ok(scopedToolNames(ctx, current).includes('read'))
      assert.equal((await execute(ctx, current, 'read')).isError, false)
      assert.ok((await assemble(ctx, current)).tools.some(t => t.name === 'read'))
    } finally { await shutdown(ctx) }
  })
  await test('the reported 48-tool stock surface boots: out-of-scope tools stay visible with one readable warning', async () => {
    const { ctx } = await bootHost()
    try {
      replacements(ctx)
      for (const name of ['read', 'glob', 'grep', ...STOCK_UNSUPPORTED_48]) ctx.tools.register(tool(name))
      const warnings = warningsFrom(ctx)
      await mount(ctx)
      const agent = await mint(ctx, 'stock-desktop-48')
      // The #207 failure was readiness: this assembly must resolve, not reject.
      const assembly = await assemble(ctx, agent)
      const names = assembly.tools.map(schema => schema.name)
      for (const name of STOCK_UNSUPPORTED_48) assert.ok(names.includes(name), `${name} must stay visible`)
      for (const name of ['read', 'glob', 'grep']) assert.equal(names.includes(name), false, `${name} is replaced and hidden`)
      assert.deepEqual([...scopedToolNames(ctx, agent)].sort(), [...names].sort())
      assert.equal((await execute(ctx, agent, 'subagent')).isError, false)
      assert.equal((await execute(ctx, agent, 'team_task_create')).isError, false)
      assert.equal((await execute(ctx, agent, 'write')).isError, false)
      assert.equal((await execute(ctx, agent, 'read')).isError, true)

      const hidingWarnings = warnings.filter(message => message.includes('dsh-ops hide-official'))
      assert.equal(hidingWarnings.length, 1, `one aggregated warning: ${JSON.stringify(hidingWarnings)}`)
      const [warning] = hidingWarnings
      assert.doesNotMatch(warning, /READINESS_BLOCKED/)
      assert.match(warning, /46 official tools stay visible because they are outside the dsh-ops takeover scope \(shell\/file\/ptc\)/)
      for (const name of ['subagent', 'team_task_create', 'terminal_send', 'session_search', 'mcp', 'schedule_create', 'web_search', 'workflow']) {
        assert.ok(warning.includes(name), `the warning names ${name}`)
      }
      assert.match(warning, /2 in-scope official tools stay visible because no registered OPS equivalent exists: edit, write/)
    } finally { await shutdown(ctx) }
  })
  await test('in-scope tools without an equivalence claim stay visible and warn instead of blocking assembly', async () => {
    const { ctx } = await bootHost()
    try {
      replacements(ctx)
      for (const name of ['read', 'write', 'str_replace_editor', 'web_search', 'subagent', 'ask_user_question', 'plan', 'foreign']) ctx.tools.register(tool(name))
      const warnings = warningsFrom(ctx)
      await mount(ctx)
      const agent = await mint(ctx, 'mixed-surface')
      const assembly = await assemble(ctx, agent)
      const names = assembly.tools.map(schema => schema.name)
      assert.equal(names.includes('read'), false)
      for (const name of ['write', 'str_replace_editor', 'web_search', 'subagent', 'ask_user_question', 'plan']) {
        assert.ok(names.includes(name), `${name} stays visible`)
        assert.equal((await execute(ctx, agent, name)).isError, false, `${name} stays dispatchable`)
      }
      const warning = warnings.find(message => message.includes('dsh-ops hide-official'))
      assert.match(warning, /2 in-scope official tools stay visible.*str_replace_editor, write/)
      assert.match(warning, /outside the dsh-ops takeover scope \(shell\/file\/ptc\).*ask_user_question, plan, subagent, web_search/)
    } finally { await shutdown(ctx) }
  })
  await test('an explicit hide request for an in-scope tool without equivalence fails closed with an executable way out', async () => {
    const { ctx } = await bootHost()
    try {
      replacements(ctx)
      for (const name of ['read', 'write', 'web_search', 'foreign']) ctx.tools.register(tool(name))
      const warnings = warningsFrom(ctx)
      await mount(ctx, { additionalOfficialTools: ['write', 'web_search'] })
      const agent = await mint(ctx, 'explicit-request')
      let message
      await assert.rejects(() => assemble(ctx, agent), error => { message = error.message; return true })
      assert.match(message, /HIDING_REQUEST_UNSATISFIABLE/)
      assert.match(message, /no registered OPS equivalent exists for write/)
      assert.match(message, /remove "write" from additionalOfficialTools/)
      assert.match(message, /disable the dsh-ops-hide-official row/)
      // Fail-closed means no partial mask: the replaced tool is visible again.
      assert.ok(scopedToolNames(ctx, agent).includes('read'))
      assert.equal((await execute(ctx, agent, 'foreign')).isError, true)
      const warning = warnings.find(text => text.includes('dsh-ops hide-official'))
      assert.match(warning, /explicit additionalOfficialTools request for web_search is ignored/)
      assert.doesNotMatch(warning, /write/)
    } finally { await shutdown(ctx) }
  })
  await test('replacement withdrawal restores official tools but blocks the turn until readiness returns', async () => {
    const { ctx } = await bootHost()
    try {
      const disposers = replacements(ctx)
      ctx.tools.register(tool('read'))
      await mount(ctx)
      const agent = await mint(ctx, 'live-readiness')
      assert.equal(scopedToolNames(ctx, agent).includes('read'), false)
      disposers[0]()
      assert.ok(scopedToolNames(ctx, agent).includes('read'))
      await assert.rejects(() => assemble(ctx, agent), /missing OPS surface:.*ops_inspect_local_file/)
      ctx.tools.register(tool(publicToolName(FILE_TOOLS[0])))
      await waitFor(() => !scopedToolNames(ctx, agent).includes('read'))
      await assemble(ctx, agent)
      // In-scope write has no reviewed replacement: it stays visible, not fatal.
      const disposeWrite = ctx.tools.register(tool('write'))
      const assembly = await assemble(ctx, agent)
      assert.ok(assembly.tools.some(schema => schema.name === 'write'))
      assert.equal(scopedToolNames(ctx, agent).includes('read'), false)
      disposeWrite()
      await assemble(ctx, agent)
    } finally { await shutdown(ctx) }
  })
  await test('own-scope official registration cannot be silently hidden by an inherited restriction', async () => {
    const { ctx } = await bootHost()
    try {
      replacements(ctx)
      await mount(ctx)
      const agent = await mint(ctx, 'own-official')
      agent.ctx.tools.register(tool('read'))
      await assert.rejects(() => assemble(ctx, agent), /unknown global tool|cannot hide own-scope/)
      assert.equal((await execute(ctx, agent, 'read')).isError, true)
      assert.ok(scopedToolNames(ctx, agent).includes('read'))
    } finally { await shutdown(ctx) }
  })
  await test('the PTC transport run_code is in scope without a replacement: kept visible and warned, session starts', async () => {
    const { ctx } = await bootHost()
    try {
      replacements(ctx)
      ctx.provide('ptcRuntime', { language: 'typescript' })
      const warnings = warningsFrom(ctx)
      await mount(ctx)
      const agent = await mint(ctx, 'transport-not-exempt')
      const lift = agent.ctx.tools.presentAs('both')
      const assembly = await assemble(ctx, agent)
      assert.ok(assembly.tools.some(schema => schema.name === 'run_code'))
      assert.match(warnings.find(message => message.includes('dsh-ops hide-official')), /in-scope official tool stays visible.*run_code/)
      assert.equal((await execute(ctx, agent, publicToolName('glob'))).isError, false)
      lift()
      await assemble(ctx, agent)
    } finally { await shutdown(ctx) }
  })
  await test('configured aliases and dynamic prefixes stay visible outside the takeover scope', async () => {
    const { ctx } = await bootHost()
    try {
      replacements(ctx)
      for (const name of ['custom_delegate', 'stagehand_tabs', 'cua_driver_native__click', 'foreign']) ctx.tools.register(tool(name))
      const warnings = warningsFrom(ctx)
      await mount(ctx, { additionalOfficialTools: ['custom_delegate'] })
      const agent = await mint(ctx, 'official-alias')
      const assembly = await assemble(ctx, agent)
      const names = assembly.tools.map(schema => schema.name)
      for (const name of ['custom_delegate', 'stagehand_tabs', 'cua_driver_native__click', 'foreign']) assert.ok(names.includes(name))
      const warning = warnings.find(message => message.includes('dsh-ops hide-official'))
      assert.match(warning, /outside the dsh-ops takeover scope/)
      assert.match(warning, /explicit additionalOfficialTools request for custom_delegate is ignored/)
    } finally { await shutdown(ctx) }
  })
  await test('a root that loses its OPS surface does not stop a healthy root', async () => {
    const { ctx } = await bootHost()
    try {
      replacements(ctx); ctx.tools.register(tool('read')); ctx.tools.register(tool('foreign'))
      await mount(ctx)
      const a = await mint(ctx, 'independent-a'), b = await mint(ctx, 'independent-b')
      await assemble(ctx, a); await assemble(ctx, b)
      const lift = b.ctx.tools.restrict({ deny: [publicToolName('inspect_local_file')] })
      await assert.rejects(() => assemble(ctx, b), /missing OPS surface:.*ops_inspect_local_file/)
      assert.equal((await execute(ctx, b, 'foreign')).isError, true)
      assert.ok(scopedToolNames(ctx, b).includes('read'), 'failed root has no partial mask')
      assert.equal(scopedToolNames(ctx, a).includes('read'), false)
      await assemble(ctx, a)
      assert.equal((await execute(ctx, a, 'foreign')).isError, false)
      lift()
      await assemble(ctx, b)
      assert.equal(scopedToolNames(ctx, b).includes('read'), false)
    } finally { await shutdown(ctx) }
  })
  await test('a failed child is blocked without stopping its healthy parent or unrelated root', async () => {
    const { ctx } = await bootHost()
    try {
      replacements(ctx); ctx.tools.register(tool('read')); ctx.tools.register(tool('foreign'))
      const hiding = await mount(ctx)
      const parent = await mint(ctx, 'independent-parent')
      const other = await mint(ctx, 'independent-root')
      const child = await mint(ctx, 'independent-child', parent)
      child.ctx.tools.register(tool('read'))
      await assert.rejects(() => assemble(ctx, child), /cannot hide own-scope/)
      assert.equal((await execute(ctx, child, 'foreign')).isError, true)
      assert.ok(scopedToolNames(ctx, child).includes('read'))
      for (const agent of [parent, other]) {
        await assemble(ctx, agent)
        assert.equal((await execute(ctx, agent, 'foreign')).isError, false)
        assert.equal(scopedToolNames(ctx, agent).includes('read'), false)
      }
      await ctx.serial('agent/disposed', { agent: child })
      await assemble(ctx, parent)
      await hiding.dispose()
      for (const agent of [parent, child, other]) assert.ok(scopedToolNames(ctx, agent).includes('read'))
    } finally { await shutdown(ctx) }
  })
  await test('inherited masks cannot conceal a child missing an OPS replacement', async () => {
    const { ctx } = await bootHost()
    try {
      replacements(ctx); ctx.tools.register(tool('read')); ctx.tools.register(tool('foreign'))
      await mount(ctx)
      const parent = await mint(ctx, 'ready-parent')
      const child = await mint(ctx, 'filtered-child', parent)
      const lift = child.ctx.tools.restrict({ deny: [publicToolName('inspect_local_file')] })
      await assert.rejects(() => assemble(ctx, child), /missing OPS surface:.*ops_inspect_local_file/)
      assert.equal((await execute(ctx, child, 'foreign')).isError, true)
      await assemble(ctx, parent)
      assert.equal(scopedToolNames(ctx, parent).includes('read'), false)
      lift()
      await assemble(ctx, child)
      assert.equal(scopedToolNames(ctx, child).includes('read'), false)
    } finally { await shutdown(ctx) }
  })
  await test('missing host restriction/guard APIs block assembly with infrastructure diagnostics', async () => {
    const { ctx } = await bootHost({ withTools: false })
    try {
      // API-drift fixture, not an override of any shared registry method.
      ctx.provide('tools', { schemas: () => FILE_TOOLS.map(n => ({ name: publicToolName(n) })), get() {} })
      await mount(ctx)
      const agent = await mint(ctx, 'missing-host-api')
      await assert.rejects(() => assemble(ctx, agent), /missing host API: restrict, guard/)
      const decision = await ctx.waterfall('tools/pre-execute', { agent, name: 'foreign' }, () => ({ kind: 'allow' }))
      assert.equal(decision.kind, 'deny')
      assert.equal(decision.info.code, 'READINESS_BLOCKED')
    } finally { await shutdown(ctx) }
  })
  await test('assembled injection of a hidden tool is rejected even when registry masking succeeded', async () => {
    const { ctx } = await bootHost()
    try {
      replacements(ctx); ctx.tools.register(tool('read'))
      await mount(ctx)
      const agent = await mint(ctx, 'assembly-verification')
      ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
        const result = await next()
        result.tools.push({ name: 'read', description: 'injected', parameters: {} })
        return result
      })
      await assert.rejects(() => assemble(ctx, agent), /assembled surface still contains hidden official tools: read/)
      assert.equal(scopedToolNames(ctx, agent).includes('read'), false, 'assembly failure preserves the verified registry mask')
      await assert.rejects(() => assemble(ctx, agent), /assembled surface still contains hidden official tools: read/)
    } finally { await shutdown(ctx) }
  })
  await test('a fail-once prompt provider blocks only that assembly and recovers on the next request', async () => {
    const { ctx } = await bootHost()
    try {
      replacements(ctx); ctx.tools.register(tool('read')); ctx.tools.register(tool('foreign'))
      await mount(ctx)
      const a = await mint(ctx, 'transient-a'), b = await mint(ctx, 'transient-b')
      await assemble(ctx, a); await assemble(ctx, b)
      let failOnce = true
      ctx.on('system-prompt/assemble', (assembly, context, next) => {
        if (context.scope === a && failOnce) { failOnce = false; throw new Error('transient fixture failure') }
        return next()
      })
      await assert.rejects(() => assemble(ctx, a), /could not be verified: transient fixture failure/)
      assert.equal(scopedToolNames(ctx, a).includes('read'), false)
      assert.equal(scopedToolNames(ctx, b).includes('read'), false, 'other root keeps its restriction')
      const recovered = await assemble(ctx, a)
      assert.equal(recovered.tools.some(t => t.name === 'read'), false)
      assert.equal((await execute(ctx, a, 'foreign')).isError, false)
      await assemble(ctx, b)
      assert.equal((await execute(ctx, b, 'foreign')).isError, false)
    } finally { await shutdown(ctx) }
  })
  await test('agent disposal lifts restrictions and remount does not retain old masks', async () => {
    const { ctx } = await bootHost()
    try {
      replacements(ctx); ctx.tools.register(tool('read'))
      const first = await mount(ctx)
      const agent = await mint(ctx, 'disposal')
      assert.equal(scopedToolNames(ctx, agent).includes('read'), false)
      await ctx.serial('agent/disposed', { agent })
      assert.ok(scopedToolNames(ctx, agent).includes('read'))
      await first.dispose()
      const second = await mount(ctx)
      await ctx.serial('agent/created', { agent })
      assert.equal(scopedToolNames(ctx, agent).includes('read'), false)
      await second.dispose()
      assert.ok(scopedToolNames(ctx, agent).includes('read'))
    } finally { await shutdown(ctx) }
  })
  await test('scope off is inert: nothing hidden, no warning, and not even a host-API readiness gate', async () => {
    {
      const { ctx } = await bootHost()
      try {
        for (const name of ['read', 'glob', 'grep', ...STOCK_UNSUPPORTED_48]) ctx.tools.register(tool(name))
        const warnings = warningsFrom(ctx)
        await mount(ctx, { scope: 'off' })
        const agent = await mint(ctx, 'scope-off')
        const assembly = await assemble(ctx, agent)
        const names = assembly.tools.map(schema => schema.name)
        for (const name of ['read', 'glob', 'grep', 'write', 'edit', 'subagent', 'terminal_send']) {
          assert.ok(names.includes(name), `${name} stays visible with scope off`)
        }
        assert.deepEqual([...scopedToolNames(ctx, agent)].sort(), [...names].sort())
        assert.equal(warnings.filter(message => message.includes('dsh-ops hide-official')).length, 0)
        assert.equal((await execute(ctx, agent, 'read')).isError, false)
        assert.equal((await execute(ctx, agent, 'subagent')).isError, false)
      } finally { await shutdown(ctx) }
    }
    {
      // No restrict/guard host API either: an inert row must not gate the session.
      const { ctx } = await bootHost({ withTools: false })
      try {
        ctx.provide('tools', { schemas: () => FILE_TOOLS.map(name => ({ name: publicToolName(name) })), get() {} })
        const warnings = warningsFrom(ctx)
        await mount(ctx, { scope: 'off' })
        const agent = await mint(ctx, 'scope-off-no-host-api')
        await assemble(ctx, agent)
        assert.equal(warnings.filter(message => message.includes('dsh-ops hide-official')).length, 0)
      } finally { await shutdown(ctx) }
    }
  })
  await test('scope extended promotes an explicit out-of-scope request into the scope and fails closed with the way out', async () => {
    const { ctx } = await bootHost()
    try {
      replacements(ctx)
      for (const name of ['read', 'subagent', 'foreign']) ctx.tools.register(tool(name))
      await mount(ctx, { scope: 'extended', additionalOfficialTools: ['subagent'] })
      const agent = await mint(ctx, 'scope-extended')
      let message
      await assert.rejects(() => assemble(ctx, agent), error => { message = error.message; return true })
      assert.match(message, /HIDING_REQUEST_UNSATISFIABLE/)
      assert.match(message, /no registered OPS equivalent exists for subagent/)
      assert.match(message, /remove "subagent" from additionalOfficialTools/)
      assert.match(message, /disable the dsh-ops-hide-official row/)
      // Fail-closed means no partial mask, and dispatch is refused while unready.
      assert.ok(scopedToolNames(ctx, agent).includes('read'))
      assert.equal((await execute(ctx, agent, 'foreign')).isError, true)
    } finally { await shutdown(ctx) }
  })
  await test('scope extended with no explicit extension is the takeover scope: the 48-tool stock surface still resolves', async () => {
    const { ctx } = await bootHost()
    try {
      replacements(ctx)
      for (const name of ['read', 'glob', 'grep', ...STOCK_UNSUPPORTED_48]) ctx.tools.register(tool(name))
      const warnings = warningsFrom(ctx)
      await mount(ctx, { scope: 'extended' })
      const agent = await mint(ctx, 'extended-stock-48')
      const assembly = await assemble(ctx, agent)
      const names = assembly.tools.map(schema => schema.name)
      for (const name of STOCK_UNSUPPORTED_48) assert.ok(names.includes(name), `${name} must stay visible`)
      for (const name of ['read', 'glob', 'grep']) assert.equal(names.includes(name), false, `${name} is replaced and hidden`)
      const hidingWarnings = warnings.filter(message => message.includes('dsh-ops hide-official'))
      assert.equal(hidingWarnings.length, 1)
      assert.doesNotMatch(hidingWarnings[0], /READINESS_BLOCKED/)
      assert.match(hidingWarnings[0], /46 official tools stay visible because they are outside the dsh-ops takeover scope \(shell\/file\/ptc\)/)
      assert.match(hidingWarnings[0], /2 in-scope official tools stay visible because no registered OPS equivalent exists: edit, write/)
      assert.equal((await execute(ctx, agent, 'subagent')).isError, false)
      assert.equal((await execute(ctx, agent, 'write')).isError, false)
      assert.equal((await execute(ctx, agent, 'read')).isError, true)
    } finally { await shutdown(ctx) }
  })
}
