/** Strict scoped takeover of the shell, file and PTC faces.
 *
 * `strict` is deliberately *not* "no official tool anywhere may survive". The
 * host keeps capabilities dsh-ops never replaces (delegation, teams, jobs,
 * sessions, media, scheduling), and treating each of them as fatal made the
 * component unusable on a stock desktop profile (#207/#238). It now means:
 * inside the three faces dsh-ops takes over, hide only what has a reviewed
 * replacement; keep everything else visible and warn with names.
 *
 * ## The manifest is the specification
 *
 * {@link TAKEOVER_MANIFEST} is the explicit takeover list: one row per pinned
 * official tool name (plus the dynamic prefixes), each carrying the face that
 * owns it, the reviewed OPS equivalent or `null`, and the reason. Official
 * tools this component is *not* responsible for are rows too, with `face: null`
 * and a reason that says so: "which official tools get hidden?" is answered by
 * data instead of by reading the classifier. Every decision below derives from
 * that list, and a test pins the docs table to it.
 *
 * ## The scope switch
 *
 * `scope` selects how wide the takeover is. It defaults to `takeover`, the
 * reviewed F4 scope, so an existing row keeps its exact behaviour:
 *
 * - `takeover` — hide only manifest rows inside shell/file/ptc that have a
 *   reviewed equivalent. Everything else stays visible and is warned about; an
 *   out-of-scope `additionalOfficialTools` entry is warned about and ignored.
 * - `extended` — the takeover scope becomes the manifest *plus* every name in
 *   `additionalOfficialTools`. A promoted name is judged by the same in-scope
 *   rule, so one with no reviewed equivalent fails closed with the executable
 *   way out instead of being ignored.
 * - `off` — the row takes over nothing: no hiding, no warning, no readiness
 *   gate. Equivalent to disabling the row while keeping it in the settings.
 *
 * `additionalOfficialTools` keeps its F4 meaning at every scope: an explicit
 * hide request. Inside the scope an unsatisfiable request fails closed; outside
 * the scope it is warned about and ignored under `takeover`, promoted under
 * `extended`, and inert under `off`.
 *
 * Fail-closed survives for exactly one case: a takeover-scope tool listed
 * explicitly in `additionalOfficialTools` while no replacement is registered.
 * That request cannot be honored without a mixed surface, so the scope stays
 * unready and the message names both ways out (drop the name, or disable the
 * row).
 */
import { ConfigError, resolveHidingConfig } from './config.js'
export { resolveHidingConfig } from './config.js'
import { FILE_TOOLS, publicToolName } from './policy.js'
import {
  isOfficialTool, OFFICIAL_REPLACEMENTS, OFFICIAL_TOOL_NAMES, OFFICIAL_TOOL_PREFIXES, platformSurface,
} from './official-tool-catalog.js'
import { safeDispose } from './teardown.js'

export const name = 'dsh-ops-hide-official'

/** The three faces dsh-ops takes over, in the order every surface presents them. */
export const TAKEOVER_FACES = Object.freeze(['shell', 'file', 'ptc'])

/**
 * One reason per capability family, shared by every tool in the family. A row's
 * reason is part of the manifest contract: it is what the docs explain and what
 * the "stays visible because …" warning paraphrases.
 */
const REASON = Object.freeze({
  shellDefault: 'Host command runner; ops_bash is the dsh-ops command executor.',
  shellRetained: 'Platform-retained host shell; the takeover never hides it.',
  shellPersistent: 'Persistent host shell session; ops_bash is stateless, so no equivalent is claimed.',
  fileReviewed: 'Reviewed OPS equivalent is registered and implemented.',
  fileNoEquivalent: 'No reviewed OPS equivalent claims the same semantics, so it stays visible.',
  ptcTransport: 'PTC transport; dsh-ops never replaces the transport itself.',
  delegation: 'Host delegation, teams and messaging; dsh-ops publishes no equivalent.',
  jobs: 'Host background jobs; dsh-ops never controls host job state.',
  sessions: 'Host session history; read-only observation, not an OPS capability.',
  mcp: 'Host MCP resource layer; dsh-ops publishes no equivalent.',
  terminal: 'Host terminal sessions; dsh-ops runs commands through ops_bash instead.',
  planning: 'Interactive host planning/approval surface; not a shell/file capability.',
  scheduling: 'Host scheduling and goal bookkeeping; dsh-ops publishes no equivalent.',
  media: 'Host media read/present surface; dsh-ops publishes no equivalent.',
  web: 'Host web access; dsh-ops publishes no equivalent.',
  orchestration: 'Host skills, workflows and autonomous loops; dsh-ops publishes no equivalent.',
  hostInspect: 'Host/plugin introspection and workspace dependency loading; not an OPS capability.',
  dynamic: 'Dynamic third-party/driver prefix; dsh-ops classifies pinned official names and never hides these.',
})

/** A row inside the takeover scope: `equivalent` is the reviewed OPS tool, or `null`. */
const inScope = (face, tool, equivalent, reason) => Object.freeze({ tool, face, equivalent: equivalent ?? null, reason, prefix: false })
/** A pinned official tool that is explicitly *not* taken over. */
const notTakenOver = (tool, reason) => Object.freeze({ tool, face: null, equivalent: null, reason, prefix: false })
/** A dynamic official prefix that is explicitly *not* taken over. */
const prefixNotTakenOver = (prefix, reason) => Object.freeze({ tool: prefix, face: null, equivalent: null, reason, prefix: true })

/**
 * The explicit takeover list: official tool → face → OPS equivalent → reason.
 *
 * Rows with a face are the takeover scope. Rows with `face: null` are official
 * tools dsh-ops deliberately leaves alone; they are kept visible and named in
 * one warning. The list is complete over `OFFICIAL_TOOL_NAMES` and
 * `OFFICIAL_TOOL_PREFIXES`; a test fails if any pinned name loses its row.
 */
export const TAKEOVER_MANIFEST = Object.freeze([
  // ── shell face ────────────────────────────────────────────────────────────
  inScope('shell', 'bash', null, REASON.shellDefault),
  inScope('shell', 'pwsh', null, REASON.shellRetained),
  inScope('shell', 'bash_persistent', null, REASON.shellPersistent),
  inScope('shell', 'pwsh_persistent', null, REASON.shellPersistent),
  // ── file face ─────────────────────────────────────────────────────────────
  inScope('file', 'read', OFFICIAL_REPLACEMENTS.read, REASON.fileReviewed),
  inScope('file', 'glob', OFFICIAL_REPLACEMENTS.glob, REASON.fileReviewed),
  inScope('file', 'grep', OFFICIAL_REPLACEMENTS.grep, REASON.fileReviewed),
  inScope('file', 'write', null, REASON.fileNoEquivalent),
  inScope('file', 'edit', null, REASON.fileNoEquivalent),
  inScope('file', 'str_replace_editor', null, REASON.fileNoEquivalent),
  // ── PTC face ──────────────────────────────────────────────────────────────
  inScope('ptc', 'run_code', null, REASON.ptcTransport),
  // ── not taken over: delegation, teams and messaging ───────────────────────
  notTakenOver('list_subagent_models', REASON.delegation),
  notTakenOver('subagent', REASON.delegation),
  notTakenOver('subagent_fork', REASON.delegation),
  notTakenOver('interrupt_agent', REASON.delegation),
  notTakenOver('list_agents', REASON.delegation),
  notTakenOver('send_message', REASON.delegation),
  notTakenOver('spawn_teammate', REASON.delegation),
  notTakenOver('wait_agent', REASON.delegation),
  notTakenOver('team_task_create', REASON.delegation),
  notTakenOver('team_task_get', REASON.delegation),
  notTakenOver('team_task_list', REASON.delegation),
  notTakenOver('team_task_update', REASON.delegation),
  // ── not taken over: host background jobs ──────────────────────────────────
  notTakenOver('job_kill', REASON.jobs),
  notTakenOver('job_list', REASON.jobs),
  notTakenOver('job_output', REASON.jobs),
  // ── not taken over: session history ───────────────────────────────────────
  notTakenOver('session_search', REASON.sessions),
  notTakenOver('session_trace', REASON.sessions),
  notTakenOver('session_event_read', REASON.sessions),
  notTakenOver('session_event_search', REASON.sessions),
  notTakenOver('session_event_trace', REASON.sessions),
  // ── not taken over: MCP resources ─────────────────────────────────────────
  notTakenOver('list_mcp_resources', REASON.mcp),
  notTakenOver('list_mcp_resource_templates', REASON.mcp),
  notTakenOver('read_mcp_resource', REASON.mcp),
  // ── not taken over: host terminal sessions ────────────────────────────────
  notTakenOver('terminal_open', REASON.terminal),
  notTakenOver('terminal_close', REASON.terminal),
  notTakenOver('terminal_list', REASON.terminal),
  notTakenOver('terminal_read', REASON.terminal),
  notTakenOver('terminal_send', REASON.terminal),
  notTakenOver('terminal_signal', REASON.terminal),
  // ── not taken over: interactive planning ──────────────────────────────────
  notTakenOver('plan', REASON.planning),
  notTakenOver('exit_plan_mode', REASON.planning),
  notTakenOver('ask_user_question', REASON.planning),
  notTakenOver('todo_write', REASON.planning),
  // ── not taken over: scheduling and goals ──────────────────────────────────
  notTakenOver('schedule_create', REASON.scheduling),
  notTakenOver('schedule_delete', REASON.scheduling),
  notTakenOver('schedule_list', REASON.scheduling),
  notTakenOver('schedule_update', REASON.scheduling),
  notTakenOver('create_goal', REASON.scheduling),
  notTakenOver('get_goal', REASON.scheduling),
  notTakenOver('update_goal', REASON.scheduling),
  // ── not taken over: media ─────────────────────────────────────────────────
  notTakenOver('present', REASON.media),
  notTakenOver('read_image', REASON.media),
  // ── not taken over: web ───────────────────────────────────────────────────
  notTakenOver('web_search', REASON.web),
  notTakenOver('web_fetch', REASON.web),
  // ── not taken over: skills and orchestration ──────────────────────────────
  notTakenOver('skill', REASON.orchestration),
  notTakenOver('workflow', REASON.orchestration),
  notTakenOver('ralph', REASON.orchestration),
  // ── not taken over: host/plugin introspection ─────────────────────────────
  notTakenOver('plugin_manager', REASON.hostInspect),
  notTakenOver('cordis_inspect_list', REASON.hostInspect),
  notTakenOver('cordis_inspect_query', REASON.hostInspect),
  notTakenOver('lsp', REASON.hostInspect),
  notTakenOver('load_workspace_dependencies', REASON.hostInspect),
  // ── not taken over: dynamic prefixes ──────────────────────────────────────
  prefixNotTakenOver(OFFICIAL_TOOL_PREFIXES[0], REASON.dynamic),
  prefixNotTakenOver(OFFICIAL_TOOL_PREFIXES[1], REASON.dynamic),
])

/** Manifest rows for pinned tool names, in manifest order. */
export const TAKEOVER_SCOPE_ROWS = Object.freeze(TAKEOVER_MANIFEST.filter(row => !row.prefix))
/** Manifest rows for dynamic tool prefixes, in manifest order. */
export const TAKEOVER_PREFIX_ROWS = Object.freeze(TAKEOVER_MANIFEST.filter(row => row.prefix))

/**
 * The official names dsh-ops takes over, grouped by face (derived from the manifest).
 *
 * Names are pinned official tool names, so a third-party tool is never
 * classified by guesswork; a configurable alias is classified only when the
 * operator lists it in `additionalOfficialTools`, and even then it stays
 * outside this scope under the default `takeover`.
 */
export const TAKEOVER_SCOPE = Object.freeze(Object.fromEntries(TAKEOVER_FACES.map(face => [
  face, Object.freeze(TAKEOVER_SCOPE_ROWS.filter(row => row.face === face).map(row => row.tool)),
])))

const FACE_BY_TOOL = new Map(TAKEOVER_SCOPE_ROWS.filter(row => row.face !== null).map(row => [row.tool, row.face]))
const EQUIVALENT_BY_TOOL = new Map(TAKEOVER_SCOPE_ROWS.filter(row => row.equivalent !== null).map(row => [row.tool, row.equivalent]))

/** The takeover face of an official tool, or `undefined` when outside scope. */
export function takeoverFace(tool) { return FACE_BY_TOOL.get(tool) }

/** The reviewed OPS equivalent of an official tool, or `undefined` when none is claimed. */
export function takeoverEquivalent(tool) { return EQUIVALENT_BY_TOOL.get(tool) }

/** The manifest row for a tool name or dynamic prefix, or `undefined`. */
export function takeoverManifestRow(tool) { return TAKEOVER_MANIFEST.find(row => row.tool === tool) }

// ── scope switch ────────────────────────────────────────────────────────────

/** The accepted `scope` values, widest last; `takeover` is the F4-reviewed default. */
export const TAKEOVER_MODES = Object.freeze(['takeover', 'extended', 'off'])
/** The scope every row gets when the key is absent: exactly F4's safe semantics. */
export const DEFAULT_TAKEOVER_MODE = 'takeover'

const modeError = value => new ConfigError(
  `scope must be one of ${TAKEOVER_MODES.map(mode => JSON.stringify(mode)).join(', ')}, got ${JSON.stringify(value)}`,
)

/**
 * Resolve one hiding row's config, including the `scope` switch.
 *
 * `scope` is read here rather than in `lib/config.js` so the switch stays part
 * of this component's own surface; the remaining keys keep their F4 validation
 * (`strict` must be `true`, the alias list stays an alias list) through
 * {@link resolveHidingConfig}.
 * @param {unknown} [raw] - the `config` value from the loader row.
 * @returns {{scope: string, strict: true, additionalOfficialTools: string[]}} resolved config.
 */
export function resolveTakeoverConfig(raw = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError('hiding config must be an object')
  const { scope, ...hiding } = /** @type {Record<string, unknown>} */ (raw)
  const resolved = resolveHidingConfig(hiding)
  if (scope === undefined || scope === null) return { ...resolved, scope: DEFAULT_TAKEOVER_MODE }
  if (!TAKEOVER_MODES.includes(/** @type {string} */ (scope))) throw modeError(scope)
  return { ...resolved, scope: /** @type {string} */ (scope) }
}

/** The declared scope of a resolved or partially resolved config, defaulting safely. */
export function takeoverMode(config = {}) {
  const mode = config?.scope ?? DEFAULT_TAKEOVER_MODE
  if (!TAKEOVER_MODES.includes(mode)) throw modeError(mode)
  return mode
}

/**
 * Whether dsh-ops is prepared to hide this official tool.
 *
 * Hiding requires all three: a takeover face, no reliance on the platform's
 * retained host shell, and a reviewed equivalent in the manifest. A similarly
 * named registration is still not evidence of equivalence, and an
 * `additionalOfficialTools` entry cannot extend hiding beyond the scope.
 * @param {string} tool - the official tool name.
 * @param {string} [platform] - the platform whose retained shell is exempt.
 * @returns {boolean} whether the tool is a hide candidate.
 */
export function isHideable(tool, platform = process.platform) {
  if (tool === platformSurface(platform).retainedCommand) return false
  return takeoverFace(tool) !== undefined && takeoverEquivalent(tool) !== undefined
}

/**
 * Split the presented surface into hide candidates and kept-visible tools.
 *
 * Never throws on the surface and never decides readiness: out-of-scope tools
 * are the host's business, and in-scope tools without an equivalent stay
 * visible. Under `scope: off` nothing is classified at all. The only
 * readiness-shaped output is `explicitUnsupported` (see {@link surfaceWarning}
 * and the explicit-blocked message in `apply`).
 * @param {string[]} names - tool names the scope presents.
 * @param {{additionalOfficialTools?: string[], scope?: string}} [config] - resolved hiding config.
 * @param {string} [platform] - platform deciding the retained host shell.
 * @returns {object} classified surface, with every list sorted by tool name.
 */
export function classifyOfficialSurface(names, config = resolveHidingConfig(), platform = process.platform) {
  const mode = takeoverMode(config)
  const { retainedCommand } = platformSurface(platform)
  const explicit = new Set(config.additionalOfficialTools ?? [])
  const official = [...new Set(names)].filter(tool => isOfficialTool(tool, [...explicit])).sort()
  const surface = {
    mode, retainedCommand, official,
    hidden: [], inScopeUnsupported: [], explicitUnsupported: [], outOfScope: [], explicitOutOfScope: [],
  }
  if (mode === 'off') return surface
  for (const tool of official) {
    if (tool === retainedCommand) continue
    const face = takeoverFace(tool)
    // `extended` promotes an explicitly named out-of-scope tool into the scope;
    // otherwise the name only earns a warning, never a mask.
    if (face === undefined && !(mode === 'extended' && explicit.has(tool))) {
      surface[explicit.has(tool) ? 'explicitOutOfScope' : 'outOfScope'].push(tool)
    } else if (takeoverEquivalent(tool) !== undefined) {
      surface.hidden.push(tool)
    } else {
      surface[explicit.has(tool) ? 'explicitUnsupported' : 'inScopeUnsupported'].push(tool)
    }
  }
  return surface
}

const count = (total, one, many) => `${total} ${total === 1 ? one : many}`

/**
 * One readable warning for everything that stays visible, or `undefined`.
 *
 * The text names every tool: an operator must be able to tell which official
 * tools were not hidden and why, without reading the source. It never contains
 * `READINESS_BLOCKED`: these tools do not stop the session.
 * @param {ReturnType<typeof classifyOfficialSurface>} surface - classified surface.
 * @returns {string|undefined} the warning sentence group.
 */
export function surfaceWarning(surface) {
  if (surface.mode === 'off') return undefined
  const keptOut = [...surface.outOfScope, ...surface.explicitOutOfScope].sort()
  const parts = []
  if (keptOut.length) {
    parts.push(`${count(keptOut.length, 'official tool stays', 'official tools stay')} visible because ${keptOut.length === 1 ? 'it is' : 'they are'} outside the dsh-ops takeover scope (shell/file/ptc): ${keptOut.join(', ')}`)
    if (surface.explicitOutOfScope.length) {
      parts.push(`the explicit additionalOfficialTools request for ${surface.explicitOutOfScope.join(', ')} is ignored: strict never fails on out-of-scope tools`)
    }
  }
  if (surface.inScopeUnsupported.length) {
    parts.push(`${count(surface.inScopeUnsupported.length, 'in-scope official tool stays', 'in-scope official tools stay')} visible because no registered OPS equivalent exists: ${surface.inScopeUnsupported.join(', ')}; list one in additionalOfficialTools to fail closed deliberately`)
  }
  return parts.length ? `dsh-ops hide-official: ${parts.join('. ')}.` : undefined
}

const blocked = detail => `READINESS_BLOCKED (EXECUTOR_UNAVAILABLE): dsh-ops hide-official cannot verify its takeover scope: ${detail}. No official tool inside shell/file/ptc stays hidden while this scope is unready; official tools outside those faces are unaffected by strict.`
const explicitBlocked = names => `READINESS_BLOCKED (HIDING_REQUEST_UNSATISFIABLE): dsh-ops hide-official cannot honor an explicit hide request inside its shell/file/ptc takeover scope: no registered OPS equivalent exists for ${names.join(', ')}. Fix: remove ${names.map(tool => `"${tool}"`).join(', ')} from additionalOfficialTools (each tool then stays visible and only warns), or disable the dsh-ops-hide-official row.`

export function apply(root, raw) {
  const config = resolveTakeoverConfig(raw)
  // `scope: off` is an inert row: no mask, no warning, no readiness gate, not
  // even a host-API check. It exists to neutralize the row without editing
  // `disabled` (shared profiles, staged rollouts).
  if (config.scope === 'off') return
  platformSurface() // Refuse an unknown platform before any surface work.
  const hideable = tool => isHideable(tool)
  root.inject(['tools', 'systemPrompt'], ctx => {
    const entries = new Map()
    let stopped = false, mutating = false, lastSurface
    const tools = ctx.get('tools')
    const apiError = ['schemas', 'get', 'restrict', 'guard'].filter(api => typeof tools[api] !== 'function')
    const fail = message => ctx.logger?.error?.(message)
    const warn = message => ctx.logger?.warn?.(message)
    const clear = entry => {
      const pending = entry.lifts.splice(0)
      const failed = []
      for (const lift of pending) {
        if (!safeDispose(lift, error => fail(`dsh-ops: restriction cleanup failed: ${error.message}`), 'official-tool restriction')) failed.push(lift)
      }
      entry.lifts.push(...failed)
      entry.cleanupError = failed.length > 0 ? 'host restriction cleanup failed; retrying before proceeding' : undefined
      return failed.length === 0
    }
    // Readiness examines the unmasked scope. It never accepts ops_<same-name>
    // as an equivalence claim, nor uses run_code as a native replacement.
    const prepare = (agent, entry) => {
      const names = tools.schemas(agent).map(schema => schema.name)
      const surface = classifyOfficialSurface(names, config)
      const missing = FILE_TOOLS.map(publicToolName).filter(tool => !names.includes(tool))
      for (const tool of surface.hidden) {
        const replacement = takeoverEquivalent(tool)
        if (!names.includes(replacement)) missing.push(`${tool} -> ${replacement}`)
      }
      const diagnostics = [
        ...apiError.length ? [`missing host API: ${apiError.join(', ')}`] : [],
        ...entry.cleanupError ? [entry.cleanupError] : [],
        ...missing.length ? [`missing OPS surface: ${[...new Set(missing)].join(', ')}`] : [],
      ]
      const failure = diagnostics.length ? blocked(diagnostics.join('; '))
        : surface.explicitUnsupported.length ? explicitBlocked(surface.explicitUnsupported) : undefined
      // A failed plan hides nothing: no partial mask over an unready scope.
      return { deny: failure ? [] : surface.hidden, warning: surfaceWarning(surface), failure }
    }
    // Compare public surfaces before touching masks. Other components also
    // reconcile tools/change; emitting a fresh restriction for an unchanged
    // surface would otherwise cause a publication/withdrawal feedback loop.
    const snapshot = () => JSON.stringify([tools.schemas(), ...[...entries.keys()].map(agent => tools.schemas(agent))])
    const reconcile = () => {
      if (stopped || mutating) return
      try { if (snapshot() === lastSurface) return } catch { /* reported by per-agent verification below */ }
      mutating = true
      try {
        // Clear all masks first: inherited restrictions must not conceal a
        // parent's missing capability while checking a child.
        for (const entry of entries.values()) clear(entry)
        const plans = []
        for (const [agent, entry] of entries) {
          const plan = prepare(agent, entry)
          entry.warning = plan.warning
          plans.push([agent, entry, plan])
        }
        // Each scope owns its readiness and mask. A failed child is blocked at
        // assembly/dispatch; it does not make a healthy ancestor or root fail.
        for (const [agent, entry, plan] of plans) {
          if (plan.failure) { clear(entry); entry.error = plan.failure; continue }
          try {
            // One restriction per complete plan; never partially hide when a
            // single required replacement is absent.
            if (plan.deny.length) entry.lifts.push(agent.ctx.tools.restrict({ deny: plan.deny }))
            const leaked = tools.schemas(agent).map(schema => schema.name).filter(hideable)
            if (leaked.length) throw new Error(`host scoped restriction cannot hide own-scope tools: ${leaked.join(', ')}`)
            entry.error = undefined
          } catch (error) { clear(entry); entry.error = blocked(error.message) }
        }
        for (const entry of entries.values()) {
          if (entry.warning !== entry.reportedWarning) {
            if (entry.warning) warn(entry.warning)
            entry.reportedWarning = entry.warning
          }
          if (entry.error !== entry.reported) {
            if (entry.error) fail(entry.error)
            entry.reported = entry.error
          }
        }
        try { lastSurface = snapshot() } catch { lastSurface = undefined }
      } finally { mutating = false }
    }
    const block = (agent, detail) => {
      const message = blocked(detail)
      // Tool providers run before this waterfall, so keep the verified mask in
      // place for the next request's schema collection. Only this assembly
      // fails; invalidate readiness so transient provider errors are retryable.
      const entry = entries.get(agent)
      if (entry) entry.error = message
      lastSurface = undefined
      return new Error(message)
    }
    const attach = agent => {
      if (!agent?.ctx || entries.has(agent)) return
      entries.set(agent, { lifts: [], error: blocked('surface verification pending') })
      reconcile()
    }
    const refusal = exec => {
      if (stopped) return blocked('component disposed')
      if (!exec?.agent?.ctx) return blocked('calling agent scope unavailable')
      attach(exec.agent)
      reconcile() // Authority is live, not a startup snapshot.
      return entries.get(exec.agent)?.error
        ?? (hideable(exec.name) ? blocked(`official tool ${exec.name} is hidden by the shell/file/ptc takeover`) : undefined)
    }
    ctx.on('tools/pre-execute', (exec, next) => {
      const reason = refusal(exec)
      return reason ? { kind: 'deny', reason, info: { code: 'READINESS_BLOCKED' } } : next()
    })
    if (typeof tools.guard === 'function') ctx.effect(() => ctx.tools.guard(refusal), 'dsh-ops: strict surface guard')
    ctx.on('system-prompt/assemble', async (assembly, context, next) => {
      // A global diagnostic assembly is not an agent AI surface.
      if (!context.scope) return next()
      attach(context.scope)
      reconcile()
      const entry = entries.get(context.scope)
      const error = entry ? entry.error : blocked('agent scope cannot be verified')
      if (error) throw new Error(error)
      let result
      try { result = await next() }
      catch (error) { throw block(context.scope, `agent prompt assembly could not be verified: ${error.message}`) }
      reconcile()
      if (entry.error) throw new Error(entry.error)
      if (!Array.isArray(result?.tools)) throw block(context.scope, 'assembled tool schemas unavailable')
      const leaked = result.tools.map(schema => schema.name).filter(hideable)
      if (leaked.length) throw block(context.scope, `assembled surface still contains hidden official tools: ${leaked.join(', ')}`)
      return result
    })
    ctx.on('agent/created', ({ agent }) => attach(agent))
    ctx.on('agent/disposed', ({ agent }) => {
      const entry = entries.get(agent)
      if (!entry) return
      mutating = true
      try { clear(entry); entries.delete(agent) } finally { mutating = false }
      reconcile()
    })
    ctx.on('tools/change', reconcile)
    ctx.effect(() => () => {
      stopped = true; mutating = true
      for (const entry of entries.values()) clear(entry)
      entries.clear()
    }, 'dsh-ops: strict official-tool restrictions')
    for (const agent of ctx.get('agents')?.list?.() ?? []) attach(agent)
    if (apiError.length) fail(blocked(`missing host API: ${apiError.join(', ')}`))
  })
}
