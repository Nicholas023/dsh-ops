/**
 * tool-gate — STATIC tool surface (cache-stable edition).
 *
 * The assemble filter pins the request's tool catalog to the configured
 * RESIDENT set, unchanged from step to step. Every step sends the exact same
 * tool schemas, so the request prefix (system prompt + tools + history) stays
 * byte-stable and the LLM provider's prefix cache keeps hitting. Non-resident
 * tools are never injected into the request; the model reaches them through
 * `gateway` (list/call), which forwards through the registry's full policy
 * pipeline with no bypass.
 *
 * This is the cache-stable sibling of the original dynamic `cot-gw` tool-gate
 * (which retired unlockable tools after `retireRounds` steps via LRU). LRU
 * churn broke the request prefix; here the surface is fixed and only the
 * message tail grows.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-gate'

/** Deliberately NO inject list: the listeners only touch services at event time. */
export const inject = []

function stringList(value, field, fallback) {
  if (value === undefined) return [...fallback]
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`${name}: ${field} must be an array of non-empty strings`)
  }
  return [...new Set(value)]
}

/** Register the static tool-surface gate. */
export function apply(ctx, config) {
  const resident = stringList(config.resident, 'resident', [])
  const includeSubagents = config.includeSubagents === true

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    try {
      const agent = context.agent
      if (agent === undefined) return assembled
      if (!includeSubagents && (agent?.session?.header?.delegationDepth ?? 0) > 0) return assembled
      const available = new Set(assembled.tools.map((tool) => tool.name))
      // STATIC surface: keep exactly the resident set (∩ available), never
      // more, never less, no LRU churn — the request prefix stays stable.
      const keep = new Set(resident.filter((name) => available.has(name)))
      return { ...assembled, tools: assembled.tools.filter((tool) => keep.has(tool.name)) }
    } catch (error) {
      try { ctx.logger.warn('%s: gate failed, exposing full catalog: %s', name, String((error && error.message) || error)) } catch {}
      return assembled
    }
  }, { prepend: true })
}
