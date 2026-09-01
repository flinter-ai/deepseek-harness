import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-workbuddy'
export const name = 'llm-workbuddy-invariant'
export const inject = ['invariants']
/**
 * No runtime invariant: this package owns no independent event sequence or mutable data relation;
 * the provider and stream contracts are enforced by the shared LLM seam.
 */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
