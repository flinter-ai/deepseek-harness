/** Package-owned invariant companion for the framework-neutral draft model. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-source-draft-model'

/** Cordis companion plugin name. */
export const name = 'source-draft-model-invariant'
/** Services required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the model is a pure per-editor state machine with no global store or event listener. */
const install: InvariantInstaller = () => {}

/** Register package ownership with the runtime invariant ledger. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
