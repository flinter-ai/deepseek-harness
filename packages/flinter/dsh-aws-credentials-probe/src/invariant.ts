/** Package-owned invariant companion for the Phase 1 AWS seam probe. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@flinter/dsh-aws-credentials-probe'

export const name = 'flinter-dsh-aws-credentials-probe-invariant'
export const inject = ['invariants']

/** No runtime invariant: the probe's contract is enforced by its provider tests. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
