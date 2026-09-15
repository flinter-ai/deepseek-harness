/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-packet-evidence`.
 *
 * Evidence integrity is enforced by the canonical Search-R1 service. This
 * companion reserves package ownership for DSH's test invariant host without
 * creating a second event or storage invariant.
 *
 * @module @deepseek-ai/dsh-packet-evidence/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-packet-evidence'

export const name = 'packet-evidence-invariant'
export const inject = ['invariants']

// No runtime invariant: evidence identity, provenance, and hard bounds are
// enforced by the canonical Search-R1 packet service at the process boundary.
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
