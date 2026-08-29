/** Package-owned invariant companion for the scaffold boundary. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@flinter/dsh-integration-contracts'
export const name = 'flinter-dsh-integration-contracts-invariant'
export const inject = ['invariants']
/** No runtime invariant: this package contains type-level integration fixtures only. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
