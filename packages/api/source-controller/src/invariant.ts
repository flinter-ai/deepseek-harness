/** Package-owned invariant companion. @module @deepseek-ai/dsh-api-source-controller/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-api-source-controller'

/** Cordis companion plugin name. */
export const name = 'api-source-controller-invariant'
/** Services required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the controller owns the only draft table and publication seam. */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['sourceController'] })

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
