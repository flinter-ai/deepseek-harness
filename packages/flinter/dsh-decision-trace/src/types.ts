/** Type contracts for bounded FLINTER decision traces. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

/** Stable identity for one decision within a durable DSH session. */
export type DecisionId = Branded<'FlinterDecisionId'>

/** Outcomes retained by failure-inclusive decision capture. */
export type DecisionStatus =
  | 'success'
  | 'rejection'
  | 'abstention'
  | 'unavailable-evidence'
  | 'malformed-response'
  | 'provider-error'
  | 'timeout'
  | 'exhaustion'
  | 'partial-retention'
  | 'export-conflict'
  | 'replay'
  | 'restart'
  | 'cancelled'
  | 'incomplete'
  | 'unknown'

/** Final retention state for a decision result. */
export type Disposition =
  | 'retained'
  | 'discarded'
  | 'abstained'
  | 'unavailable'
  | 'partial'
  | 'unknown'

/** Bounded opaque reference supplied by a producer adapter. */
export type DecisionRef = string

/** Allowlisted pre-execution fields written to the session log. */
export interface SelectionProjection {
  readonly allowedActions: readonly DecisionRef[]
  readonly chosenAction: DecisionRef
  readonly parameterRefs: readonly DecisionRef[]
  readonly requestedEvidenceRefs: readonly DecisionRef[]
  readonly fetchedEvidenceRefs: readonly DecisionRef[]
  readonly displayedEvidenceRefs: readonly DecisionRef[]
  readonly observedEvidenceRefs: readonly DecisionRef[]
  readonly budgetBefore: number | null
  readonly candidateRefs: readonly DecisionRef[]
  readonly lineageRefs: readonly DecisionRef[]
  readonly sourceRef: DecisionRef
  readonly modelRef: DecisionRef
  readonly policyRevisionRef: DecisionRef
}

/** Allowlisted post-execution fields written to the session log. */
export interface ResultProjection {
  readonly outcome: DecisionStatus
  readonly usage: number | null
  readonly disposition: Disposition
  readonly resultRefs: readonly DecisionRef[]
  readonly evidenceRefs: readonly DecisionRef[]
  readonly lineageStatus: 'known' | 'unknown'
  readonly recordingReady: boolean
  readonly indexReady: boolean
}

/** Producer-owned projection from one exact tool to bounded trace fields. */
export interface DecisionTraceAdapter {
  readonly projectSelection: (exec: Readonly<ToolExecution>) => SelectionProjection
  readonly projectResult: (
    exec: Readonly<ToolExecution>,
    result: Readonly<ToolExecutionResult>,
  ) => ResultProjection
}

/** Durable pre-execution decision event payload. */
export interface DecisionSelectionEvent {
  readonly decisionId: DecisionId
  readonly callId: string
  readonly toolName: string
  readonly phase: 'selection'
  readonly projection: SelectionProjection
}

/** Durable post-execution decision event payload. */
export interface DecisionResultEvent {
  readonly decisionId: DecisionId
  readonly callId: string
  readonly toolName: string
  readonly phase: 'result'
  readonly projection: ResultProjection
}

/** One replayed decision pair or an explicitly incomplete half-pair. */
export interface DecisionEpisode {
  readonly decisionId: DecisionId
  readonly callId: string
  readonly toolName: string
  selection?: DecisionSelectionEvent
  result?: DecisionResultEvent
  status: DecisionStatus
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Bounded selection facts captured before one registered tool executes.
     * Raw arguments, prompts, content, credentials, and error text are excluded.
     * @param data - stable call identity and the producer's validated allowlist projection.
     * @dshScopeScan unsupported
     */
    'flinter/decision-selection': DecisionSelectionEvent
    /**
     * Bounded result facts captured after one registered tool settles.
     * Raw content, provider responses, credentials, and error text are excluded.
     * @param data - stable call identity and the producer's validated allowlist projection.
     * @dshScopeScan unsupported
     */
    'flinter/decision-result': DecisionResultEvent
  }
}
