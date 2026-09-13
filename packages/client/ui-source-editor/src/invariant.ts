/** Package-owned invariant companion for the Sandpack source editor. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-source-editor'

/** Cordis companion plugin name. */
export const name = 'client-ui-source-editor-invariant'
/** Services required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: editor state lives in component/model instances and has no global cache. */
const install: InvariantInstaller = () => {}

/** Register package ownership with the runtime invariant ledger. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
