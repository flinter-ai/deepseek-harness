/** Package-owned invariant companion for the native-event compatibility probe. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@flinter/dsh-native-event-consumer'
export const name = 'flinter-dsh-native-event-consumer-invariant'
export const inject = ['invariants']
/** No runtime invariant: the probe is a pure, non-loaded event consumer. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
