/** Package-owned invariant companion for the GitHub source publisher. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-source-publisher-github'

/** Cordis companion plugin name. */
export const name = 'host-source-publisher-github-invariant'
/** Services required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: each request owns its temporary worktree and the publisher has no background state. */
const install: InvariantInstaller = () => {}

/** Register package ownership with the runtime invariant ledger. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
