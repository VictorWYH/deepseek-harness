/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-dashboard-shell`.
 * @module @deepseek-ai/dsh-client-ui-dashboard-shell/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-dashboard-shell'

/** Cordis companion plugin name. */
export const name = 'client-ui-dashboard-shell-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the shell holds only browser-local Agent selection
 * state and forwards Session actions through the runtime services. The
 * root-slot shadowing contract (priority -1 wins over the default 0) is
 * asserted directly by this package's apply spec.
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
