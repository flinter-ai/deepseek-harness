/** Validate the composed profile's saved selection before publishing app readiness. */
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'

interface DefaultModelHost {
  get(name: string): unknown
}

/**
 * Use the mounted adapter's capability check, without generating or rewriting settings.
 * Custom profiles without these model services retain their existing boot behavior.
 * @param ctx - fully composed profile host.
 */
export async function assertDefaultModelReady(ctx: DefaultModelHost): Promise<void> {
  const defaults = ctx.get('agentDefaultModel') as { currentSelection(): LlmCallConfig } | undefined
  const llm = ctx.get('llm') as { resolveCallConfig(config: LlmCallConfig): Promise<LlmCallConfig> } | undefined
  if (defaults === undefined || llm === undefined) return
  try {
    await llm.resolveCallConfig(defaults.currentSelection())
  } catch (error) {
    // An unmounted saved provider is an existing, recoverable UI state: the
    // composer stays inert until the user selects an available model.
    if (typeof error === 'object' && error !== null
      && 'code' in error && error.code === 'NO_ADAPTER') return
    throw error
  }
}
