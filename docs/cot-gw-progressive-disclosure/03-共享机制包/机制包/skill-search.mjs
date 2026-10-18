/**
 * skill-search v2 — on-demand skill discovery and loading (drawer edition).
 *
 * Replaces `dsh-tool-skill`'s full-catalog injection: the <available_skills>
 * block (~9KB with many skills) is NOT injected into the request; instead two
 * small tools let the model discover and load skills only when needed — the
 * Claude tool-search pattern:
 *
 *  - `skill_search` — list skills whose name/description match a query
 *    (summaries only, bounded; no bodies). An EMPTY query lists ALL skills.
 *  - `skill_load` — load ONE skill's full instructions by exact name and
 *    inject them for the NEXT request via `agent.inject` (the non-waking
 *    next-step inbox).
 *
 * v2 changes (vs the cot-gw-static original):
 *  - No hard-coded skill list anywhere: the "no match" fallbacks are generic
 *    and point back to an empty-query listing.
 *  - `config.aliases` ({skillName: "keyword string"}) adds per-preset search
 *    keywords so a preset's priority skills are findable by Chinese/common
 *    terms even when their descriptions do not contain them.
 *  - `config.hint` (string) prepends a short "priority skills" note to the
 *    search tool description, replacing the hard-coded known-skills list.
 *
 * Discovery reads `ctx.skills` scoped to the calling agent, exactly like
 * dsh-tool-skill. If skills are unavailable the tools answer with a short
 * message instead of throwing.
 *
 * NOTE: this plugin REPLACES the `dsh-tool-skill` row in the composition —
 * the composition must NOT mount both, or the catalog injection returns.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'skill-search'

/** The agent, tools, and skills services must exist before these tools can register. */
export const inject = ['agents', 'tools', 'skills']

const MAX_RESULTS = 20

/** Minimal JSON schema compiler for tool parameters (zero dependencies). */
function toJsonSchema(spec) {
  const properties = {}
  const required = []
  for (const [key, meta] of Object.entries(spec || {})) {
    const prop = { type: meta.type }
    if (meta.description) prop.description = meta.description
    properties[key] = prop
    if (meta.required) required.push(key)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

function normalizeAliases(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    if (typeof k === 'string' && k.length > 0 && typeof v === 'string') out[k] = v
  }
  return out
}

/** Register the two on-demand skill tools. */
export function apply(ctx, config = {}) {
  const ALIASES = normalizeAliases(config.aliases)
  const hint = typeof config.hint === 'string' && config.hint.length > 0 ? config.hint : ''
  /** Normalize a query into lowercase tokens for simple substring matching. */
  const tokens = (text) => (text || '').toLowerCase().split(/[^a-z0-9_-]+/).filter(Boolean)

  const searchDescription = [
    'Search the available skills by keyword and return matching skill names with short descriptions.',
    'This session keeps NO full skill catalog — skill_search IS the way to discover what exists (an EMPTY query, e.g. " ", lists ALL skills).',
    'Call skill_search FIRST to find a skill for the task at hand, then skill_load to activate it. Do NOT assume skill names from memory.',
    hint ? `Priority skills for this session: ${hint}` : '',
  ].filter(Boolean).join(' ')

  ctx.tools.register({
    name: 'skill_search',
    description: searchDescription,
    parameters: toJsonSchema({
      query: { type: 'string', required: true, description: 'search keywords (empty string or " " lists all skills)' },
    }),
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] },
      render: (_a, v) => [{ type: 'text', text: v.text }],
    },
    async execute(args, exec) {
      const wanted = tokens(args.query)
      const scope = exec?.agent ?? ctx
      try {
        const all = await ctx.skills.list({
          scope,
          cwd: exec?.agent?.session?.header?.cwd,
          signal: exec?.signal,
        })
        const haystackFor = (skill) => tokens(`${skill.name} ${skill.description ?? ''} ${skill.whenToUse ?? ''} ${ALIASES[skill.name] ?? ''}`).join(' ')
        const matches = all.filter((skill) => {
          if (wanted.length === 0) return true
          const haystack = haystackFor(skill)
          return wanted.every((token) => haystack.includes(token))
        })
        const head = matches.slice(0, MAX_RESULTS)
        const lines = head.map((skill) => {
          const desc = (skill.description || '').split('\n')[0]
          return `- ${skill.name}: ${desc}`
        })
        if (lines.length === 0) {
          // Closest-match fallback: report the nearest skill instead of silence.
          let best = null, bestScore = 0
          for (const skill of all) {
            const hay = tokens(`${skill.name} ${skill.description ?? ''} ${ALIASES[skill.name] ?? ''}`).join(' ')
            const score = wanted.filter((w) => hay.includes(w)).length
            if (score > bestScore) { bestScore = score; best = skill }
          }
          if (best && bestScore > 0) {
            return { text: `No exact match for "${args.query}". Closest available skill: ${best.name} — ${(best.description || '').split('\n')[0]}\nLoad it with skill_load (exact name), or list ALL skills with an empty query (" ").` }
          }
          return { text: `No skills match "${args.query}". List ALL skills with an empty query (" ").` }
        }
        const extra = matches.length > MAX_RESULTS ? `\n…(${matches.length - MAX_RESULTS} more)` : ''
        return { text: `Matching skills (${matches.length}):\n${lines.join('\n')}${extra}\n\nLoad one with skill_load (exact name).` }
      } catch (error) {
        return { text: `skill_search unavailable: ${String((error && error.message) || error)}` }
      }
    },
  })

  ctx.tools.register({
    name: 'skill_load',
    description: 'Load the full instructions of ONE skill by its exact name (from skill_search results) and inject them for the next request. Call this before acting on a task that matches the skill.',
    parameters: toJsonSchema({
      name: { type: 'string', required: true, description: 'exact skill name (kebab-case, from skill_search)' },
    }),
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] },
      render: (_a, v) => [{ type: 'text', text: v.text }],
    },
    async execute(args, exec) {
      try {
        const agent = exec?.agent
        if (agent === undefined) return { text: 'skill_load requires an agent context.' }
        let skill = await ctx.skills.get(args.name, {
          scope: agent,
          cwd: agent.session.header.cwd,
          signal: exec?.signal,
        }).catch(() => undefined)
        if (skill === undefined) {
          // Name-normalization fallbacks: exact → case-insensitive → dsh- prefix stripped → substring.
          const all = await ctx.skills.list({ scope: agent, cwd: agent.session.header.cwd, signal: exec?.signal }).catch(() => [])
          const want = String(args.name).toLowerCase().replace(/^dsh-/, '')
          skill = all.find((s) => s.name === args.name)
            ?? all.find((s) => s.name.toLowerCase() === want)
            ?? all.find((s) => (s.name || '').toLowerCase().replace(/^dsh-/, '') === want)
            ?? all.find((s) => (s.name || '').toLowerCase().includes(want) || want.includes((s.name || '').toLowerCase()))
        }
        if (skill === undefined) {
          // Filesystem fallback: skill definitions live in $DSH_HOME/skills/<name>/SKILL.md
          try {
            const home = process.env.DSH_HOME || join(homedir(), '.dsh')
            const fs = await import('node:fs/promises')
            for (const nm of [args.name, String(args.name).toLowerCase()]) {
              const p = `${home}/skills/${nm}/SKILL.md`
              const ok = await fs.access(p).then(() => true).catch(() => false)
              if (ok) {
                skill = { name: nm, content: await fs.readFile(p, 'utf-8') }
                break
              }
            }
          } catch (e) { /* keep generic */ }
        }
        if (skill === undefined) {
          return { text: `No skill named "${args.name}". List ALL available skills with skill_search(" ").` }
        }
        const body = extractSkillBody(skill)
        if (body.length === 0) {
          return { text: `Skill "${args.name}" has no loadable body.` }
        }
        // Queue the skill content as a non-waking next-step context message,
        // exactly like dsh-tool-skill's invocation injection.
        agent.inject({
          id: `skill-load-${args.name}-${Date.now()}`,
          role: 'user',
          content: [{ type: 'text', text: body }],
          source: { kind: 'skill-invocation', name: args.name, form: 'instructions' },
        })
        return { text: `Skill "${args.name}" loaded; its instructions will be injected for the next request.` }
      } catch (error) {
        return { text: `skill_load failed: ${String((error && error.message) || error)}` }
      }
    },
  })
}

/** Extract the model-facing body of a loaded skill definition. */
function extractSkillBody(skill) {
  const content = skill?.content ?? skill?.instructions ?? skill?.body
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join('\n')
  }
  return ''
}
