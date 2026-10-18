import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { resolveHidingConfig } from '../lib/config.js'
import { isOfficialTool, OFFICIAL_TOOL_NAMES, OFFICIAL_TOOL_PREFIXES, OFFICIAL_REPLACEMENTS, platformSurface } from '../lib/official-tool-catalog.js'
import {
  classifyOfficialSurface, DEFAULT_TAKEOVER_MODE, isHideable, resolveTakeoverConfig, surfaceWarning,
  TAKEOVER_MANIFEST, TAKEOVER_MODES, TAKEOVER_PREFIX_ROWS, TAKEOVER_SCOPE, TAKEOVER_SCOPE_ROWS,
  takeoverEquivalent, takeoverFace, takeoverManifestRow,
} from '../lib/official-tool-hiding.js'
import { assert, PACKAGE_ROOT, report, test } from './lib/harness.mjs'
import { officialToolHidingMountChecks, STOCK_UNSUPPORTED_48 } from './lib/official-tool-hiding.mjs'

await test('strict hiding config is independent, rejects downgrade/unknown keys and copies aliases', () => {
  assert.deepEqual(resolveHidingConfig(), { strict: true, additionalOfficialTools: [] })
  for (const config of [null, [], false, { strict: false }, { strict: 'true' }, { required: true },
    { additionalOfficialTools: 'subagent' }, { additionalOfficialTools: [''] }, { additionalOfficialTools: ['ops_read'] }]) {
    assert.throws(() => resolveHidingConfig(config))
  }
  const raw = { additionalOfficialTools: ['custom_delegation', 'custom_delegation'] }
  const result = resolveHidingConfig(raw)
  raw.additionalOfficialTools.push('another')
  assert.deepEqual(result.additionalOfficialTools, ['custom_delegation'])
})
await test('strict hiding is disabled opt-in and the pinned platform surface is exact', () => {
  const document = parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'cordis.patch.yml'), 'utf8'), {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }],
  })
  const rows = document.flatMap(item => item.insert)
  const hiding = rows.find(row => row.name === 'dsh-ops/hide-official')
  // Registered but never enabled by default: enabling the row is an operator
  // decision, and a component that hid host capabilities by default would
  // change every install's surface without one.
  assert.equal(hiding.disabled, true)
  assert.deepEqual(resolveHidingConfig(hiding.config), { strict: true, additionalOfficialTools: [] })
  for (const platform of ['win32', 'linux', 'darwin']) {
    assert.deepEqual(platformSurface(platform), { retainedCommand: platform === 'win32' ? 'pwsh' : 'bash', shellDefaultEnabled: true })
  }
  assert.throws(() => platformSurface('freebsd'), /Unsupported/)
})
await test('catalog covers the pinned official categories without guessing third-party or OPS equivalence', () => {
  assert.equal(new Set(OFFICIAL_TOOL_NAMES).size, OFFICIAL_TOOL_NAMES.length)
  for (const name of ['run_code', 'bash', 'pwsh', 'read', 'read_image', 'write', 'edit', 'glob', 'grep', 'str_replace_editor',
    'exit_plan_mode', 'subagent', 'subagent_fork', 'ask_user_question', 'web_search', 'web_fetch', 'terminal_send', 'plugin_manager',
    'schedule_create', 'list_mcp_resources', 'session_trace', 'lsp', 'workflow', 'team_task_list', 'stagehand_tabs', 'cua_driver_native__dynamic']) {
    assert.equal(isOfficialTool(name), true, name)
  }
  for (const name of ['foreign', 'mcp__server__tool', 'ops_read', 'ops_glob']) assert.equal(isOfficialTool(name), false)
  assert.equal(isOfficialTool('custom_alias', ['custom_alias']), true)
  assert.deepEqual(Object.keys(OFFICIAL_REPLACEMENTS).sort(), ['glob', 'grep', 'read'])
})
await test('the takeover scope is exactly shell/file/ptc, and hiding needs a reviewed replacement', () => {
  assert.deepEqual(Object.keys(TAKEOVER_SCOPE), ['shell', 'file', 'ptc'])
  for (const [tool, face] of [['bash', 'shell'], ['pwsh', 'shell'], ['read', 'file'], ['write', 'file'],
    ['str_replace_editor', 'file'], ['run_code', 'ptc']]) assert.equal(takeoverFace(tool), face, tool)
  // Host capabilities the component was never meant to replace are out of scope.
  assert.equal(takeoverFace('subagent'), undefined)
  assert.equal(takeoverFace('terminal_send'), undefined)
  assert.equal(takeoverFace('read_image'), undefined)
  assert.equal(takeoverFace('web_search'), undefined)
  for (const tool of ['read', 'glob', 'grep']) assert.equal(isHideable(tool, 'win32'), true, tool)
  // In scope without a reviewed replacement: a hide candidate is not claimed.
  for (const tool of ['write', 'edit', 'str_replace_editor', 'run_code']) assert.equal(isHideable(tool, 'linux'), false, tool)
  // The platform's retained host shell is never hidden, on either side.
  assert.equal(isHideable('pwsh', 'win32'), false)
  assert.equal(isHideable('bash', 'linux'), false)
  assert.equal(isHideable('subagent', 'win32'), false)
  // An alias cannot extend hiding outside the scope, even when it is official.
  assert.equal(isHideable('custom_delegate', 'linux'), false)
})
await test('the takeover manifest is complete, reasoned and the single source of the scope', () => {
  // Every row is an explicit triple: official tool -> face -> equivalent -> reason.
  for (const row of TAKEOVER_MANIFEST) {
    assert.equal(typeof row.tool, 'string', JSON.stringify(row))
    assert.equal(typeof row.prefix, 'boolean')
    assert.equal(typeof row.reason, 'string')
    assert.ok(row.reason.length > 20, `${row.tool} carries a real reason`)
    if (row.prefix) {
      assert.equal(row.face, null, `${row.tool} is a prefix and cannot own a face`)
      assert.equal(row.equivalent, null)
    } else if (row.face === null) {
      assert.equal(row.equivalent, null, `${row.tool} is outside the scope and must claim no equivalent`)
    } else {
      assert.ok(['shell', 'file', 'ptc'].includes(row.face), `${row.tool} has a takeover face`)
    }
    if (row.equivalent !== null) assert.equal(OFFICIAL_REPLACEMENTS[row.tool], row.equivalent)
  }
  // Complete over the pinned catalog: delete a row and this goes red rather than
  // quietly narrowing the takeover or forgetting a "not taken over" annotation.
  assert.deepEqual(TAKEOVER_SCOPE_ROWS.map(row => row.tool).sort(), [...OFFICIAL_TOOL_NAMES].sort())
  assert.deepEqual(TAKEOVER_PREFIX_ROWS.map(row => row.tool), [...OFFICIAL_TOOL_PREFIXES])
  assert.equal(new Set(TAKEOVER_MANIFEST.map(row => row.tool)).size, TAKEOVER_MANIFEST.length)
  // The reviewed equivalence registry cannot drift away from the manifest either.
  assert.deepEqual(TAKEOVER_SCOPE_ROWS.filter(row => row.equivalent !== null).map(row => row.tool).sort(),
    Object.keys(OFFICIAL_REPLACEMENTS).sort())
  // Scale, pinned: 11 in scope over shell/file/ptc, 52 explicitly not taken over, 2 prefixes.
  assert.equal(TAKEOVER_SCOPE_ROWS.filter(row => row.face !== null).length, 11)
  assert.equal(TAKEOVER_SCOPE_ROWS.filter(row => row.face === null).length, 52)
  assert.equal(TAKEOVER_PREFIX_ROWS.length, 2)
  assert.equal(takeoverEquivalent('read'), OFFICIAL_REPLACEMENTS.read)
  assert.equal(takeoverEquivalent('write'), undefined)
  assert.equal(takeoverManifestRow('subagent').face, null)
  assert.match(takeoverManifestRow('subagent').reason, /delegation/iu)
  assert.match(takeoverManifestRow('stagehand_').reason, /prefix/iu)
})
await test('the scope switch defaults to the F4 takeover scope and validates every value', () => {
  assert.deepEqual([...TAKEOVER_MODES], ['takeover', 'extended', 'off'])
  assert.equal(DEFAULT_TAKEOVER_MODE, 'takeover')
  // A row without `scope` is the F4 config plus the safe default: unchanged behaviour.
  assert.deepEqual(resolveTakeoverConfig(), { strict: true, additionalOfficialTools: [], scope: 'takeover' })
  assert.deepEqual(resolveTakeoverConfig({ strict: true }), { strict: true, additionalOfficialTools: [], scope: 'takeover' })
  for (const scope of TAKEOVER_MODES) {
    assert.deepEqual(resolveTakeoverConfig({ scope, additionalOfficialTools: ['subagent'] }),
      { strict: true, additionalOfficialTools: ['subagent'], scope })
  }
  for (const bad of ['strict', '', 'TAKEOVER', 'extend', 'on', true, 3, [], {}]) {
    assert.throws(() => resolveTakeoverConfig({ scope: bad }), /scope must be one of/)
  }
  // The F4 keys keep their exact validation while `scope` is added.
  assert.throws(() => resolveTakeoverConfig({ scope: 'takeover', strict: false }), /strict must be true/)
  assert.throws(() => resolveTakeoverConfig({ scope: 'takeover', additionalOfficialTools: ['ops_read'] }), /additionalOfficialTools/)
  assert.throws(() => resolveTakeoverConfig({ scope: 'takeover', required: true }), /unknown hiding key/)
})
await test('scope selects how far the takeover reaches: takeover ignores, extended promotes, off hides nothing', () => {
  const names = ['read', 'glob', 'grep', 'write', 'subagent', 'pwsh', 'foreign']
  const classify = config => classifyOfficialSurface(names, resolveTakeoverConfig(config), 'linux')

  const takeover = classify({ additionalOfficialTools: ['subagent', 'write'] })
  assert.equal(takeover.mode, 'takeover')
  assert.deepEqual(takeover.hidden, ['glob', 'grep', 'read'])
  assert.deepEqual(takeover.explicitOutOfScope, ['subagent'])
  assert.deepEqual(takeover.explicitUnsupported, ['write'])
  assert.match(surfaceWarning(classify({ additionalOfficialTools: ['subagent'] })),
    /explicit additionalOfficialTools request for subagent is ignored/)

  const extended = classify({ scope: 'extended', additionalOfficialTools: ['subagent', 'write'] })
  assert.equal(extended.mode, 'extended')
  assert.deepEqual(extended.hidden, ['glob', 'grep', 'read'])
  assert.deepEqual(extended.explicitOutOfScope, [])
  assert.deepEqual(extended.explicitUnsupported, ['subagent', 'write'])
  assert.doesNotMatch(surfaceWarning(classify({ scope: 'extended', additionalOfficialTools: ['subagent'] })),
    /is ignored/)

  const off = classify({ scope: 'off', additionalOfficialTools: ['subagent', 'write'] })
  assert.equal(off.mode, 'off')
  assert.deepEqual(off.official, ['glob', 'grep', 'pwsh', 'read', 'subagent', 'write'])
  for (const key of ['hidden', 'inScopeUnsupported', 'explicitUnsupported', 'outOfScope', 'explicitOutOfScope']) {
    assert.deepEqual(off[key], [], `${key} stays empty under scope off`)
  }
  assert.equal(surfaceWarning(off), undefined)
})
await test('the component-reference scope table is the manifest, not a copy that can drift', () => {
  const expected = TAKEOVER_MANIFEST.map(row => [
    row.prefix ? `${row.tool}*` : row.tool,
    row.face === null ? (row.prefix ? 'prefix' : 'outside') : row.face,
    row.equivalent === null ? '—' : row.equivalent,
  ])
  for (const file of ['docs/component-reference.md', 'docs/组件参考.md']) {
    const text = fs.readFileSync(path.join(PACKAGE_ROOT, file), 'utf8')
    const block = /<!-- hide-official-scope:start -->([\s\S]*?)<!-- hide-official-scope:end -->/u.exec(text)
    assert.ok(block, `${file} carries the marked scope table`)
    const rows = []
    for (const line of block[1].split('\n')) {
      if (!line.trim().startsWith('|')) continue
      const cells = line.split('|').map(cell => cell.trim())
      const tool = cells[1]?.replaceAll('`', '')
      if (!tool || /^-+$/u.test(tool) || ['Official tool', '官方工具'].includes(tool)) continue
      rows.push([tool, cells[2]?.replaceAll('`', ''), cells[3]?.replaceAll('`', '')])
    }
    assert.deepEqual(rows, expected, `${file} lists exactly the manifest rows, in manifest order`)
  }
})
await test('the reported 48-tool surface classifies without a fatal condition and keeps every out-of-scope tool', () => {
  // The #207 stock surface: 48 unsupported tools plus read/glob/grep (replaced)
  // and pwsh (the Windows retained host shell) — 52 official tools in total.
  const surface = [...STOCK_UNSUPPORTED_48, 'read', 'glob', 'grep', 'pwsh']
  assert.equal(surface.length, 52)
  assert.equal(new Set(surface).size, 52)
  const outOfScope = STOCK_UNSUPPORTED_48.filter(tool => !['edit', 'write'].includes(tool)).sort()
  assert.equal(outOfScope.length, 46)

  const win = classifyOfficialSurface(surface, resolveHidingConfig(), 'win32')
  assert.equal(win.official.length, 52)
  assert.equal(win.retainedCommand, 'pwsh')
  assert.deepEqual(win.hidden, ['glob', 'grep', 'read'])
  assert.deepEqual(win.outOfScope, outOfScope)
  assert.deepEqual(win.inScopeUnsupported, ['edit', 'write'])
  assert.deepEqual(win.explicitUnsupported, [])
  const warning = surfaceWarning(win)
  assert.doesNotMatch(warning, /READINESS_BLOCKED/)
  assert.match(warning, /46 official tools stay visible because they are outside the dsh-ops takeover scope \(shell\/file\/ptc\)/)
  assert.match(warning, /2 in-scope official tools stay visible because no registered OPS equivalent exists: edit, write/)

  // `pwsh` is the retained host shell on Windows, and an in-scope unsupported
  // tool on Linux — never a hide candidate and never fatal on either platform.
  const linux = classifyOfficialSurface(surface, resolveHidingConfig(), 'linux')
  assert.deepEqual(linux.inScopeUnsupported, ['edit', 'pwsh', 'write'])
  assert.equal(linux.outOfScope.length, 46)
  assert.deepEqual(linux.hidden, ['glob', 'grep', 'read'])

  // `additionalOfficialTools` escalates an in-scope tool into fail-closed and
  // is only warned about outside the scope. Classification itself never throws.
  const explicit = classifyOfficialSurface(surface, resolveHidingConfig({ additionalOfficialTools: ['write', 'subagent', 'pwsh'] }), 'win32')
  assert.deepEqual(explicit.explicitUnsupported, ['write'])
  assert.deepEqual(explicit.explicitOutOfScope, ['subagent'])
  assert.equal(explicit.inScopeUnsupported.includes('pwsh'), false)
  assert.match(surfaceWarning(explicit), /explicit additionalOfficialTools request for subagent is ignored/)
})
await officialToolHidingMountChecks()
report('official-tool-hiding')
