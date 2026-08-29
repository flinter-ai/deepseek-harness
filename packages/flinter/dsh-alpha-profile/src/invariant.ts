/** Package-owned invariant companion for the FLINTER alpha profile layer. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-alpha-profile'

export const name = 'flinter-dsh-alpha-profile-invariant'
export const inject = ['invariants']

/** No runtime invariant: profile values are pure data and seam behavior is tested separately. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
