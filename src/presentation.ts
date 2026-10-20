/** Inspect public presentation before publishing a replacement. Inspection is
 * marked by exact context identity and never becomes a provider request.
 * Native-presentation verdicts are memoized per scope so that repeated
 * discovery reconciles do not re-assemble the system prompt for every agent. */
import type { AssembleContext, PromptAssembly, SystemPrompt } from '@deepseek-ai/dsh-system-prompt'

const probes = new WeakSet<AssembleContext>()
export function isPresentationProbe(context: AssembleContext): boolean { return probes.has(context) }
export async function inspectPresentation(prompt: Pick<SystemPrompt, 'assemble'>, scope: NonNullable<AssembleContext['scope']>, signal?: AbortSignal): Promise<PromptAssembly> {
  const context: AssembleContext = { scope, signal }
  probes.add(context)
  try {
    return await prompt.assemble(context)
  } finally { probes.delete(context) }
}

/** One memoized native-presentation verdict: the exact prompt instance it was
 * computed from (a different instance invalidates the entry) and the pending
 * verdict so concurrent callers share a single assembly. */
interface NativeEntry {
  prompt: Pick<SystemPrompt, 'assemble'>
  result: Promise<boolean>
}

/** Per-scope memo, keyed by the agent object; entries survive until the owning
 * component invalidates them on dispose or relevant change. */
const nativeCache = new Map<object, NativeEntry>()

/** Invalidate one scope's cached verdict; the next probe re-assembles. */
export function invalidateNativePresentation(scope: NonNullable<AssembleContext['scope']>): void {
  nativeCache.delete(scope)
}

/** Drop every cached verdict (component teardown). */
export function clearNativePresentationCache(): void {
  nativeCache.clear()
}

/** Memoized per-scope native-presentation probe: concurrent callers share one
 * assembly, cached callers assemble nothing, and a failed probe is evicted so
 * the next reconcile retries it. */
export function isNativePresentation(prompt: Pick<SystemPrompt, 'assemble'>, scope: NonNullable<AssembleContext['scope']>): Promise<boolean> {
  const cached = nativeCache.get(scope)
  if (cached && cached.prompt === prompt) return cached.result
  const result = inspectPresentation(prompt, scope).then(
    assembly => !assembly.sections.some(section => section.name === 'tools:ptc-only' && Boolean(section.text.trim())),
    error => { invalidateNativePresentation(scope); throw error },
  )
  nativeCache.set(scope, { prompt, result })
  return result
}
