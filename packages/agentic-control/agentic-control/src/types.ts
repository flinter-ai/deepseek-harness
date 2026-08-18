/**
 * Pure types of the investigation-control domain: candidate identity,
 * physical evidence dimensions, attempt provenance, and the provider
 * channel. Free of host-side imports (cordis events, dsh-agent, the
 * service) so client aggregates may consume them.
 *
 * @module @deepseek-ai/dsh-agentic-control/types
 */

/**
 * Hand-observation validity of the candidate window, assessed independently
 * of every other physical dimension.
 */
export type HandObservation = 'unknown' | 'valid' | 'invalid'

/** Reliability of one trace channel; `absent` means the channel produced nothing. */
export type TraceQuality = 'unknown' | 'reliable' | 'degraded' | 'absent'

/** Whether the observed hand-object interaction supports the candidate action family. */
export type HoiSupport = 'unknown' | 'positive' | 'negative'

/** Candidate under investigation; identity comes from the caller, never from the model. */
export interface CandidateRef {
  /** Stable candidate identifier (e.g. a Tower candidate id). */
  readonly id: string
  /** Action family the candidate is hypothesized to belong to. */
  readonly actionFamily: string
  /** Human-readable window descriptor (e.g. a time range) the evidence covers. */
  readonly window: string
}

/** Derived coverage of the evidence requirements. */
export type EvidenceStatus = 'pending' | 'partial' | 'satisfied'

/** Evidence requirements and their derived current coverage. */
export interface EvidenceState {
  /** Requirement labels the investigation must satisfy before it may finish. */
  readonly requirements: readonly string[]
  /** Derived from the physical dimensions; never set directly. */
  readonly currentStatus: EvidenceStatus
}

/** The four physical dimensions, each assessed independently. */
export interface PhysicalState {
  readonly handObservation: HandObservation
  readonly traceQuality: TraceQuality
  readonly hoiSupport: HoiSupport
  readonly objectTraceQuality: TraceQuality
}

/**
 * Lineage verdict. Only a provider may move it past `unknown`; tool
 * arguments and model output can never attach or reject lineage.
 */
export type Lineage = 'unknown' | 'attached' | 'rejected'

/** Durable lifecycle phase of an investigation. */
export type InvestigationPhase = 'active' | 'finished' | 'stopped-unknown'

/** Bounded macro-actions recorded in the attempt log. */
export type AttemptAction = 'run_physical_assessment'

/** Outcome of one committed attempt. */
export type AttemptOutcome = 'completed' | 'failed'

/**
 * Origin of the assessment data. P0 ships only the `stub` provider; real
 * Tower adapters extend this union with their own provenance tag.
 */
export type AttemptProvenance = 'stub'

/** One durable attempt record; failures consume budget exactly like successes. */
export interface AttemptRecord {
  readonly action: AttemptAction
  /** Id of the provider that produced (or failed) this attempt. */
  readonly provider: string
  readonly outcome: AttemptOutcome
  readonly provenance: AttemptProvenance
  /** Epoch milliseconds of the attempt commit. */
  readonly at: number
  /** Failure detail; present only when `outcome` is `failed`. */
  readonly reason?: string
}

/** Attempt budget: every assessment attempt, failed or not, consumes one slot. */
export interface InvestigationBudget {
  readonly maxAttempts: number
  readonly usedAttempts: number
}

/** Complete durable investigation state; every change event carries a full snapshot. */
export interface InvestigationState {
  /** Positive revision; every durable mutation increments it by one. */
  readonly revision: number
  readonly candidate: CandidateRef
  readonly evidence: EvidenceState
  readonly physical: PhysicalState
  readonly lineage: Lineage
  readonly attempts: readonly AttemptRecord[]
  readonly budget: InvestigationBudget
  readonly phase: InvestigationPhase
}

/** Privileged start input; investigations are created by the harness, never by the model. */
export interface StartInvestigationRequest {
  readonly candidateId: string
  readonly actionFamily: string
  readonly window: string
  /** Requirement labels; each must be non-empty after trimming. */
  readonly requirements: readonly string[]
  /** Per-investigation attempt cap; the service configuration default applies when omitted. */
  readonly maxAttempts?: number
}

/** Typed result returned by a physical-assessment provider. */
export interface PhysicalAssessmentResult {
  /** Independently assessed physical dimensions. */
  readonly physical: PhysicalState
  /** Lineage verdict when the provider is authoritative for it. */
  readonly lineage?: 'attached' | 'rejected'
  /** Non-empty human- and model-readable summary of the assessment. */
  readonly summary: string
}

/**
 * Physical-assessment provider channel. P0 ships a `stub` provider; a real
 * Tower adapter implements this surface and registers it on the service.
 */
export interface PhysicalAssessmentProvider {
  /** Stable provider id recorded on every attempt it produces. */
  readonly id: string
  /** Provenance tag recorded on every attempt it produces. */
  readonly provenance: AttemptProvenance
  /**
   * Assess one candidate window.
   * @param state - current durable investigation state.
   * @returns the typed assessment; a throw commits a failed attempt that still consumes budget.
   */
  assess(state: InvestigationState): PhysicalAssessmentResult | Promise<PhysicalAssessmentResult>
}
