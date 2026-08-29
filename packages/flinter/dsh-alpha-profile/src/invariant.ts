/** Package-owned invariant companion for the FLINTER alpha profile layer. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@flinter/dsh-alpha-profile'

export const name = 'flinter-dsh-alpha-profile-invariant'
export const inject = ['invariants']

/** Profile values are pure data; provider/credential behavior is tested at the seam. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
