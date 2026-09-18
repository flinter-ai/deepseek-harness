import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-decision-trace'

/** Invariant plugin identity. */
export const name = 'flinter-decision-trace-invariant'

/** Required service dependencies. */
export const inject = ['invariants']

// No runtime invariant: projection validation is enforced at the capture boundary.
const install: InvariantInstaller = () => {}

/** Register the package-owned empty invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => (
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
)
