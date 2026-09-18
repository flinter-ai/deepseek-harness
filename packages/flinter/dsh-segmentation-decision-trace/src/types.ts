/**
 * Producer-owned normalized segmentation decision records.
 *
 * A segmentation tool resolves these bounded facts from its own execution
 * inputs and results; this package validates them and projects them into the
 * FLINTER `SelectionProjection`/`ResultProjection` capture contract. Fields
 * that are absent stay absent — the projection reports empty reference lists,
 * `null` measurements, `'unknown'` lineage, and `false` readiness rather than
 * fabricating facts the producer did not supply.
 */

import type {
  DecisionRef,
  DecisionStatus,
  Disposition,
} from '@deepseek-ai/dsh-decision-trace'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

export type { DecisionStatus, Disposition } from '@deepseek-ai/dsh-decision-trace'

/**
 * Bounded pre-execution decision facts for one segmentation call.
 *
 * Every field is either an opaque producer-assigned reference or a measured
 * scalar. Raw model arguments, prompts, provider payloads, URLs, media, and
 * error text are never representable here.
 */
export interface SegmentationDecisionRequest {
  /** Opaque refs for every action the decision boundary allowed. Non-empty. */
  readonly allowedActions: readonly DecisionRef[]
  /** Opaque ref for the chosen action; must be a member of `allowedActions`. */
  readonly chosenAction: DecisionRef
  /** Opaque refs identifying bounded decision parameters. Defaults to none. */
  readonly parameterRefs?: readonly DecisionRef[]
  /** Evidence refs requested before the decision. Defaults to none. */
  readonly requestedEvidenceRefs?: readonly DecisionRef[]
  /** Evidence refs actually fetched before the decision. Defaults to none. */
  readonly fetchedEvidenceRefs?: readonly DecisionRef[]
  /** Evidence refs surfaced to the requester before execution. Defaults to none. */
  readonly displayedEvidenceRefs?: readonly DecisionRef[]
  /** Evidence refs observed at the decision boundary. Defaults to none. */
  readonly observedEvidenceRefs?: readonly DecisionRef[]
  /**
   * Non-negative safe-integer budget measured before the decision, or `null`
   * when the producer did not measure one. Defaults to `null` (unknown).
   */
  readonly budgetBefore?: number | null
  /** Opaque refs for candidates the decision considered. Defaults to none. */
  readonly candidateRefs?: readonly DecisionRef[]
  /** Opaque refs for decision-input lineage. Defaults to none. */
  readonly lineageRefs?: readonly DecisionRef[]
  /** Opaque ref for the producing source revision. Required. */
  readonly sourceRef: DecisionRef
  /** Opaque ref for the producing model revision. Required. */
  readonly modelRef: DecisionRef
  /** Opaque ref for the policy revision in force. Required. */
  readonly policyRevisionRef: DecisionRef
}

/**
 * Bounded post-execution decision facts for one segmentation call.
 *
 * `outcome` and `disposition` are required so the producer must state each
 * explicitly — including `'unknown'` — instead of letting a default hide a
 * missing fact.
 */
export interface SegmentationDecisionResult {
  /** The decision outcome, including failure and replay statuses. Required. */
  readonly outcome: DecisionStatus
  /** The final retention state of the decision result. Required. */
  readonly disposition: Disposition
  /**
   * Non-negative safe-integer usage measured for the decision, or `null` when
   * cost is unknown. Defaults to `null` (unknown); never fabricated.
   */
  readonly usage?: number | null
  /** Opaque refs for produced result artifacts. Defaults to none. */
  readonly resultRefs?: readonly DecisionRef[]
  /** Opaque refs for evidence attached to the result. Defaults to none. */
  readonly evidenceRefs?: readonly DecisionRef[]
  /**
   * Whether result lineage is established. Defaults to `'unknown'` when the
   * producer did not supply it.
   */
  readonly lineageStatus?: 'known' | 'unknown'
  /** Whether the result is ready for durable recording. Defaults to `false`. */
  readonly recordingReady?: boolean
  /** Whether the result is ready for indexing. Defaults to `false`. */
  readonly indexReady?: boolean
}

/**
 * Producer-owned resolvers that extract normalized decision facts from one
 * tool execution. The producer decides which facts its tool can truthfully
 * report; this package validates and projects whatever it returns.
 */
export interface SegmentationDecisionSource {
  /**
   * Extract normalized pre-execution facts for one tool call.
   * @param exec - the immutable tool execution snapshot.
   * @returns the normalized request record for this call.
   */
  readonly request: (exec: Readonly<ToolExecution>) => SegmentationDecisionRequest
  /**
   * Extract normalized post-execution facts for one settled tool call.
   * @param exec - the immutable tool execution snapshot.
   * @param result - the immutable tool execution result (success or failure).
   * @returns the normalized result record for this call.
   */
  readonly result: (
    exec: Readonly<ToolExecution>,
    result: Readonly<ToolExecutionResult>,
  ) => SegmentationDecisionResult
}
