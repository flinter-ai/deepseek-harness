export const SEGMENT_CAPABILITY_ID = 'towert.segment.v1' as const
export const SEGMENT_OUTPUT_SCHEMA_VERSION = 'segment-v1' as const

export type SegmentStatus = 'completed' | 'partial' | 'failed'
export type SegmentActionFamily = 'CUT' | 'CLEAN' | 'TIE' | 'UNKNOWN'

export interface SegmentPartial {
  readonly reason: string
  readonly missing_components: readonly ('candidates' | 'classifications' | 'contact_sheets' | 'boundary_frames')[]
  readonly discontinuity_observation_refs?: readonly string[]
}

export interface SegmentFailure {
  readonly error_category: string
  readonly failed_stage?: string
  readonly message: string
  readonly retriable: boolean
}

export interface SegmentEnvelope {
  readonly capability_id: typeof SEGMENT_CAPABILITY_ID
  readonly output_schema_version: typeof SEGMENT_OUTPUT_SCHEMA_VERSION
  readonly status: SegmentStatus
  readonly candidates: readonly Record<string, unknown>[]
  readonly classifications: readonly Record<string, unknown>[]
  readonly partial?: SegmentPartial
  readonly failure?: SegmentFailure
  readonly [key: string]: unknown
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be non-empty`)
  return value
}

/** Validate only harness-owned invariants; the canonical TowerT schema validates every scientific field. */
export function validateSegmentEnvelope(input: unknown): SegmentEnvelope {
  const envelope = record(input, 'segment envelope')
  if (envelope.capability_id !== SEGMENT_CAPABILITY_ID) throw new Error('segment capability_id is not towert.segment.v1')
  if (envelope.output_schema_version !== SEGMENT_OUTPUT_SCHEMA_VERSION) throw new Error('segment output schema version is not segment-v1')
  if (!['completed', 'partial', 'failed'].includes(envelope.status as string)) throw new Error('segment status is invalid')
  if (!Array.isArray(envelope.candidates) || !Array.isArray(envelope.classifications)) throw new Error('segment arrays are required')
  const candidates = envelope.candidates.map((value, index) => record(value, `candidate ${index}`))
  const classifications = envelope.classifications.map((value, index) => record(value, `classification ${index}`))
  if (envelope.status === 'completed' && (envelope.partial !== undefined || envelope.failure !== undefined)) {
    throw new Error('completed segment cannot carry partial or failure details')
  }
  if (envelope.status === 'partial') {
    const partial = record(envelope.partial, 'partial')
    nonEmpty(partial.reason, 'partial.reason')
    if (!Array.isArray(partial.missing_components) || partial.missing_components.length === 0) throw new Error('partial.missing_components is required')
  }
  if (envelope.status === 'failed') {
    if (candidates.length !== 0 || classifications.length !== 0) throw new Error('failed segment must contain no scientific output')
    const failure = record(envelope.failure, 'failure')
    nonEmpty(failure.message, 'failure.message')
    if (typeof failure.retriable !== 'boolean') throw new Error('failure.retriable is required')
  }
  for (const classification of classifications) {
    if (classification.abstained === true) {
      if (classification.action_family !== 'UNKNOWN') throw new Error('abstention must use action_family UNKNOWN')
      nonEmpty(classification.abstain_reason, 'abstain_reason')
    }
  }
  return Object.freeze({
    ...envelope,
    candidates: Object.freeze(candidates),
    classifications: Object.freeze(classifications),
  }) as SegmentEnvelope
}
