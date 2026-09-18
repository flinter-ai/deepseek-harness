/**
 * Package-owned invariant companion for
 * `@deepseek-ai/dsh-segmentation-decision-trace`.
 * @module @deepseek-ai/dsh-segmentation-decision-trace/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-segmentation-decision-trace'

/** Invariant plugin identity. */
export const name = 'flinter-segmentation-decision-trace-invariant'

/** Required service dependencies. */
export const inject = ['invariants']

// No runtime invariant: adapter registration and disposal are owned by the
// plugin fiber through DecisionTraceService.register, and normalized-record
// validation fails closed at the adapter and session-capture boundaries.
const install: InvariantInstaller = () => {}

/** Register the package-owned empty invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => (
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
)
