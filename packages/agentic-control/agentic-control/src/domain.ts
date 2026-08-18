/**
 * Host-side vocabulary of the investigation domain: durable change payloads,
 * the scoped session event, and stable error codes. Kept separate from
 * ./types.ts (the pure outlet) because these declarations pull dsh-session
 * into the program.
 * @module @deepseek-ai/dsh-agentic-control
 */

import type { InvestigationState } from './types.ts'

/** State-changing verbs recorded in the durable investigation change. */
export type InvestigationOperation =
  | 'start'
  | 'assess'
  | 'assess-failed'
  | 'finish'
  | 'stop-unknown'

/** Full-snapshot investigation mutation committed by a durable `investigation/change` event. */
export interface InvestigationChangeMeta {
  readonly kind: 'investigation/change'
  readonly version: 1
  readonly operation: InvestigationOperation
  /** Complete post-mutation state. */
  readonly state: InvestigationState
  /** Required for `stop-unknown`, present on `assess-failed`; absent otherwise. */
  readonly reason?: string
  /** Epoch milliseconds of the commit. */
  readonly at: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Complete post-mutation investigation state. Required-on-read: builds
     * that do not know its type refuse the log.
     */
    'investigation/change': InvestigationChangeMeta
  }
}

/** Stable error codes for rejected investigation reads and mutations. */
export type InvestigationErrorCode =
  | 'INVESTIGATION_AGENT_NOT_LIVE'
  | 'INVESTIGATION_EXISTS'
  | 'INVESTIGATION_NOT_FOUND'
  | 'INVESTIGATION_CLOSED'
  | 'INVESTIGATION_BUDGET_EXHAUSTED'
  | 'INVESTIGATION_NOT_FINISHABLE'
  | 'INVESTIGATION_INVALID_REQUEST'
  | 'INVESTIGATION_UNKNOWN_PROVIDER'
  | 'INVESTIGATION_INVALID_RESULT'
