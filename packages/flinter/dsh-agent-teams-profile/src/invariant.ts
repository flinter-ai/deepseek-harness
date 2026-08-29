/** Package-owned invariant companion for the scaffold boundary. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@flinter/dsh-agent-teams-profile'
export const name = 'flinter-dsh-agent-teams-profile-invariant'
export const inject = ['invariants']
/** No runtime invariant: this package is a non-loaded profile descriptor. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
