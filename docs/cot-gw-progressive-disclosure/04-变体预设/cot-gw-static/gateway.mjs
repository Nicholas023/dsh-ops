/**
 * gateway — the single entry point to the full tool catalog.
 *
 * The model surface stays at the official minimal pair plus this one tool;
 * every other capability (file ops, search, background tasks, web, user
 * questions, planning, goals, delegation, orchestration, skills, vision) is
 * reached through gateway forwarding, which executes the target tool through
 * the registry's full policy pipeline (pre-execute guards, approval,
 * dispatch, finalization) — nothing is bypassed.
 *
 * - gateway({"action":"list"}) — full catalog: every tool with its complete
 *   parameter schema (names marked with * are required).
 * - gateway({"action":"call","tool":"<name>","args":{...}}) — forward to the
 *   tool with the given arguments.
 *
 * The description carries quick-start notes for the capabilities bash cannot
 * reach (image analysis with attachment ids, web search).
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'gateway'

/** The tools registry must exist before this tool can register. */
export const inject = ['tools']

const QUICKSTART = [
  'Quick starts:',
  '- List the full catalog with parameter schemas: gateway({"action":"list"})',
  '- Call any tool: gateway({"action":"call","tool":"<name>","args":{...}}). Read the list output for exact parameter names and required fields.',
  '- The catalog covers: file operations, search, background tasks, web search, asking the user, planning, goals, delegation, orchestration, skills, vision.',
]

/** Render a forwarding result as plain text. On failure, guide the model to
 * the catalog so it can learn the correct parameters — a learning path after
 * a real error, not a prescription of which tool to use. */
function renderResult(result) {
  if (result?.isError) {
    const msg = (result.error?.message ?? result.content?.[0]?.text ?? 'unknown error')
    return `Error: ${msg}\n(Tip: run gateway({"action":"list"}) to see the exact parameter names and schema for this tool before retrying.)`
  }
  const parts = (result?.content ?? [])
    .map((block) => (block.type === 'text' ? block.text : JSON.stringify(block)))
    .filter(Boolean)
  return parts.join('\n') || '(no output)'
}

/** Register the model-facing `gateway` tool. */
export function apply(ctx) {
  ctx.tools.register({
    name: 'gateway',
    description: [
      'Gateway to the full tool catalog: call any tool by name, or list the catalog with complete parameter schemas.',
      'Use gateway({"action":"list"}) to inspect available tools and their parameters, then gateway({"action":"call","tool":"<name>","args":{...}}) to execute one.',
      'The catalog covers: file operations, search, background tasks, web search, asking the user, planning, goals, delegation, orchestration, skills, vision.',
      QUICKSTART,
    ].join('\n'),
    parameters: {
      type: 'object',
      additionalProperties: true,
      properties: {
        action: { type: 'string', enum: ['list', 'call'], description: 'list = catalog with parameter schemas; call = execute a tool.' },
        tool: { type: 'string', description: 'Exact tool name to call (from the catalog).' },
        args: { type: 'object', description: 'Arguments object matching the tool\'s parameter schema.' },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'string' },
      render: (_a, v) => [{ type: 'text', text: String(v) }],
    },
    async execute(args, exec) {
      try {
        if (args.action === 'list') {
          const schemas = (ctx.tools.schemas(exec?.agent) ?? [])
            .filter((s) => s.name !== 'gateway')
            .sort((a, b) => a.name.localeCompare(b.name))
          const lines = schemas.map((s) => `- ${s.name}: ${(s.description || '').split('\n')[0]}`)
          return `Catalog (${schemas.length} tools, compact index):\n${lines.join('\n')}\n\nUse gateway({"action":"describe","tool":"<name>"}) for exact parameters of one tool, then gateway({"action":"call","tool":"<name>","args":{...}}) to execute.`
        }
        if (args.action === 'describe') {
          if (typeof args.tool !== 'string' || args.tool.length === 0) return 'Missing "tool" name.'
          const found = (ctx.tools.schemas(exec?.agent) ?? []).find((s) => s.name === args.tool)
          if (!found) return `Unknown tool "${args.tool}". Run gateway list.`
          return `${found.name}: ${found.description || ''}\nparameters: ${JSON.stringify(found.parameters ?? {})}`
        }
        if (args.action !== 'call') return 'Unknown action (use "list", "describe" or "call").'
        if (typeof args.tool !== 'string' || args.tool.length === 0) return 'Missing "tool" name.'
        const result = await ctx.tools.execute({
          name: args.tool,
          arguments: args.args ?? {},
          agent: exec?.agent,
          parent: exec,
          signal: exec?.signal,
          callId: `gateway-${args.tool}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        })
        return renderResult(result)
      } catch (error) {
        return `gateway failed: ${String((error && error.message) || error)}`
      }
    },
  })
}
