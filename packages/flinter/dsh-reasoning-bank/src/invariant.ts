/** Package-specific invariant companion. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-reasoning-bank'

export const name = 'reasoning-bank-invariant'
export const inject = ['invariants']

/** No runtime invariant: bank bounds and accepted-result checks are enforced at ingest. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
