/** Package-owned durable investigation-change invariants. @module @deepseek-ai/dsh-agentic-control/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import {
  applyInvestigationEvent,
  emptyInvestigationFoldState,
} from './fold.ts'
import type { InvestigationFoldState } from './fold.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-agentic-control'

/** Cordis companion plugin name. */
export const name = 'agentic-control-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Per-session fold accumulator plus the count of events already folded. */
interface TrackedFold {
  readonly fold: InvestigationFoldState
  observed: number
}

/** Report one fold violation against one event. */
function failEvent(fail: InvariantFailure, event: SessionEvent, error: unknown): void {
  /* v8 ignore next -- the fold throws only Error instances */
  fail(`investigation/change at session event ${event.seq}: ${error instanceof Error ? error.message : String(error)}`)
}

/** Fold one session's log from scratch, reporting the first violation. */
function seed(session: Session, fail: InvariantFailure): TrackedFold {
  const tracked: TrackedFold = { fold: emptyInvestigationFoldState(), observed: 0 }
  for (const event of session.events) {
    try {
      applyInvestigationEvent(tracked.fold, event)
    } catch (error: unknown) {
      failEvent(fail, event, error)
    }
    tracked.observed += 1
  }
  return tracked
}

/** Install validation for loaded and newly appended investigation changes. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const tracked = new WeakMap<Session, TrackedFold>()
  for (const session of ctx.sessions.list()) {
    tracked.set(session, seed(session, fail))
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (event.type !== 'investigation/change') return
    const state = tracked.get(session) ?? seed(session, fail)
    tracked.set(session, state)
    // A seed that already folded this event (append precedes dispatch) skips it.
    if (event.seq < state.observed) return
    try {
      applyInvestigationEvent(state.fold, event)
    } catch (error: unknown) {
      failEvent(fail, event, error)
    }
    state.observed += 1
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the investigation invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
