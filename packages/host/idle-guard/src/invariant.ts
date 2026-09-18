/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-idle-guard`.
 * @module @deepseek-ai/dsh-host-idle-guard/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-idle-guard'

/** Cordis companion plugin name. */
export const name = 'host-idle-guard-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin publishes one file-side fact consumed by an
 * out-of-process systemd controller; the in-process surface is a passive read
 * of `ctx.webServer`, `ctx.jobs`, and `ctx.terminals` counters with no owned
 * registrations, and the fail-closed controller owns every lifecycle decision.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
