/** Pure replay fold and strict decoder for durable investigation changes. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { INVESTIGATION_CHANGE_VERSION } from './runtime.ts'
import type {
  AttemptOutcome,
  AttemptRecord,
  EvidenceStatus,
  HandObservation,
  HoiSupport,
  InvestigationPhase,
  InvestigationState,
  Lineage,
  PhysicalState,
  TraceQuality,
} from './types.ts'
import type { InvestigationChangeMeta, InvestigationOperation } from './domain.ts'

const OPERATIONS: ReadonlySet<InvestigationOperation> = new Set([
  'start',
  'assess',
  'assess-failed',
  'finish',
  'stop-unknown',
])
const HAND_OBSERVATIONS: ReadonlySet<HandObservation> = new Set(['unknown', 'valid', 'invalid'])
const TRACE_QUALITIES: ReadonlySet<TraceQuality> = new Set(['unknown', 'reliable', 'degraded', 'absent'])
const HOI_SUPPORTS: ReadonlySet<HoiSupport> = new Set(['unknown', 'positive', 'negative'])
const EVIDENCE_STATUSES: ReadonlySet<EvidenceStatus> = new Set(['pending', 'partial', 'satisfied'])
const LINEAGES: ReadonlySet<Lineage> = new Set(['unknown', 'attached', 'rejected'])
const PHASES: ReadonlySet<InvestigationPhase> = new Set(['active', 'finished', 'stopped-unknown'])
const ATTEMPT_OUTCOMES: ReadonlySet<AttemptOutcome> = new Set(['completed', 'failed'])

/** Mutable accumulator kept private to the pure fold. */
export interface InvestigationFoldState {
  current: InvestigationState | undefined
}

/**
 * Build an empty replay accumulator.
 * @returns mutable state with no current investigation.
 */
export function emptyInvestigationFoldState(): InvestigationFoldState {
  return { current: undefined }
}

/** Whether a value is a JSON record rather than an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Require the exact own-key set of one record. */
function requireKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    throw new Error(`investigation change ${field} must have exactly ${[...keys].sort().join(',')} fields`)
  }
}

/** Require one non-empty, already-trimmed string. */
function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    throw new Error(`investigation change ${field} must be a non-empty normalized string`)
  }
  return value
}

/** Require one positive safe integer. */
function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`investigation change ${field} must be a positive safe integer`)
  }
  return value
}

/** Require one non-negative safe integer. */
function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`investigation change ${field} must be a non-negative safe integer`)
  }
  return value
}

/** Decode one member of a closed string union. */
function decodeEnum<T extends string>(value: unknown, allowed: ReadonlySet<T>, field: string): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) {
    throw new Error(`investigation change ${field} is invalid`)
  }
  return value as T
}

/**
 * Derive evidence status as a pure function of the four physical dimensions.
 * @param physical - independently assessed physical evidence dimensions.
 * @returns the aggregate evidence status.
 */
export function deriveEvidenceStatus(physical: PhysicalState): EvidenceStatus {
  const dimensions = [
    physical.handObservation,
    physical.traceQuality,
    physical.hoiSupport,
    physical.objectTraceQuality,
  ]
  const resolved = dimensions.filter(dimension => dimension !== 'unknown').length
  return resolved === 0 ? 'pending' : resolved === dimensions.length ? 'satisfied' : 'partial'
}

/**
 * Decode and validate one physical-dimension record.
 * @param value - untrusted serialized physical-dimension value.
 * @returns the validated physical state.
 */
export function decodePhysical(value: unknown): PhysicalState {
  if (!isRecord(value)) throw new Error('investigation change state.physical must be a record')
  requireKeys(value, ['handObservation', 'traceQuality', 'hoiSupport', 'objectTraceQuality'], 'state.physical')
  return {
    handObservation: decodeEnum(value['handObservation'], HAND_OBSERVATIONS, 'state.physical.handObservation'),
    traceQuality: decodeEnum(value['traceQuality'], TRACE_QUALITIES, 'state.physical.traceQuality'),
    hoiSupport: decodeEnum(value['hoiSupport'], HOI_SUPPORTS, 'state.physical.hoiSupport'),
    objectTraceQuality: decodeEnum(value['objectTraceQuality'], TRACE_QUALITIES, 'state.physical.objectTraceQuality'),
  }
}

/** Decode and validate one attempt record. */
function decodeAttempt(value: unknown): AttemptRecord {
  if (!isRecord(value)) throw new Error('investigation change state.attempts entries must be records')
  const hasReason = value['reason'] !== undefined
  requireKeys(
    value,
    hasReason ? ['action', 'at', 'outcome', 'provenance', 'provider', 'reason'] : ['action', 'at', 'outcome', 'provenance', 'provider'],
    'state.attempts entry',
  )
  if (value['action'] !== 'run_physical_assessment') {
    throw new Error('investigation change state.attempts entry action is invalid')
  }
  const outcome = decodeEnum(value['outcome'], ATTEMPT_OUTCOMES, 'state.attempts entry outcome')
  if (value['provenance'] !== 'stub') {
    throw new Error('investigation change state.attempts entry provenance is invalid')
  }
  if (hasReason && outcome !== 'failed') {
    throw new Error('investigation change state.attempts entry reason requires a failed outcome')
  }
  return {
    action: 'run_physical_assessment',
    provider: requiredString(value['provider'], 'state.attempts entry provider'),
    outcome,
    provenance: 'stub',
    at: nonNegativeInteger(value['at'], 'state.attempts entry at'),
    ...hasReason ? { reason: requiredString(value['reason'], 'state.attempts entry reason') } : {},
  }
}

/** Decode and validate one full investigation state snapshot. */
function decodeState(value: unknown): InvestigationState {
  if (!isRecord(value)) throw new Error('investigation change state must be a record')
  requireKeys(
    value,
    ['attempts', 'budget', 'candidate', 'evidence', 'lineage', 'phase', 'physical', 'revision'],
    'state',
  )
  const candidate = value['candidate']
  if (!isRecord(candidate)) throw new Error('investigation change state.candidate must be a record')
  requireKeys(candidate, ['actionFamily', 'id', 'window'], 'state.candidate')
  const evidence = value['evidence']
  if (!isRecord(evidence)) throw new Error('investigation change state.evidence must be a record')
  requireKeys(evidence, ['currentStatus', 'requirements'], 'state.evidence')
  if (!Array.isArray(evidence['requirements'])) {
    throw new Error('investigation change state.evidence.requirements must be an array')
  }
  const requirements = evidence['requirements'].map((requirement: unknown) =>
    requiredString(requirement, 'state.evidence.requirements entry'))
  const physical = decodePhysical(value['physical'])
  const currentStatus = decodeEnum(evidence['currentStatus'], EVIDENCE_STATUSES, 'state.evidence.currentStatus')
  if (currentStatus !== deriveEvidenceStatus(physical)) {
    throw new Error('investigation change state.evidence.currentStatus contradicts state.physical')
  }
  const budget = value['budget']
  if (!isRecord(budget)) throw new Error('investigation change state.budget must be a record')
  requireKeys(budget, ['maxAttempts', 'usedAttempts'], 'state.budget')
  const maxAttempts = positiveInteger(budget['maxAttempts'], 'state.budget.maxAttempts')
  const usedAttempts = nonNegativeInteger(budget['usedAttempts'], 'state.budget.usedAttempts')
  if (usedAttempts > maxAttempts) {
    throw new Error('investigation change state.budget.usedAttempts exceeds maxAttempts')
  }
  if (!Array.isArray(value['attempts'])) {
    throw new Error('investigation change state.attempts must be an array')
  }
  const attempts = value['attempts'].map(decodeAttempt)
  if (usedAttempts !== attempts.length) {
    throw new Error('investigation change state.budget.usedAttempts must equal the attempt count')
  }
  return {
    revision: positiveInteger(value['revision'], 'state.revision'),
    candidate: {
      id: requiredString(candidate['id'], 'state.candidate.id'),
      actionFamily: requiredString(candidate['actionFamily'], 'state.candidate.actionFamily'),
      window: requiredString(candidate['window'], 'state.candidate.window'),
    },
    evidence: { requirements, currentStatus },
    physical,
    lineage: decodeEnum(value['lineage'], LINEAGES, 'state.lineage'),
    attempts,
    budget: { maxAttempts, usedAttempts },
    phase: decodeEnum(value['phase'], PHASES, 'state.phase'),
  }
}

/**
 * Decode a value that declares itself as an investigation change. Unrelated
 * values return `undefined`; malformed investigation changes fail replay loudly.
 * @param value - candidate source change.
 * @returns validated investigation change or `undefined` for another value kind.
 */
export function decodeInvestigationChange(value: unknown): InvestigationChangeMeta | undefined {
  if (!isRecord(value) || value['kind'] !== 'investigation/change') return undefined
  if (value['version'] !== INVESTIGATION_CHANGE_VERSION) {
    throw new Error(`unsupported investigation change version ${String(value['version'])}`)
  }
  const operation = value['operation']
  if (typeof operation !== 'string' || !OPERATIONS.has(operation as InvestigationOperation)) {
    throw new Error('investigation change operation is invalid')
  }
  const hasReason = value['reason'] !== undefined
  requireKeys(
    value,
    hasReason ? ['at', 'kind', 'operation', 'reason', 'state', 'version'] : ['at', 'kind', 'operation', 'state', 'version'],
    '',
  )
  if (operation === 'stop-unknown' && !hasReason) {
    throw new Error('investigation stop-unknown change requires a reason')
  }
  if (hasReason) requiredString(value['reason'], 'reason')
  return {
    kind: 'investigation/change',
    version: INVESTIGATION_CHANGE_VERSION,
    operation: operation as InvestigationOperation,
    state: decodeState(value['state']),
    ...hasReason ? { reason: value['reason'] as string } : {},
    at: nonNegativeInteger(value['at'], 'at'),
  }
}

/**
 * Validate and apply one decoded change to a mutable accumulator. The fold
 * enforces what the write side promises: one investigation per session,
 * single-step revisions, attempts appended only by assess operations, and no
 * mutation after a terminal phase.
 * @param fold - preceding durable investigation projection.
 * @param change - decoded full-snapshot change.
 */
export function applyInvestigationChange(fold: InvestigationFoldState, change: InvestigationChangeMeta): void {
  const current = fold.current
  const next = change.state
  if (change.operation === 'start') {
    if (current !== undefined) throw new Error('investigation start requires no existing investigation')
    if (next.revision !== 1 || next.phase !== 'active' || next.attempts.length !== 0
      || next.budget.usedAttempts !== 0 || next.lineage !== 'unknown'
      || next.evidence.currentStatus !== 'pending') {
      throw new Error('investigation start requires a fresh active revision-one state')
    }
    fold.current = next
    return
  }
  if (current === undefined) {
    throw new Error(`investigation ${change.operation} requires a current investigation`)
  }
  if (current.phase !== 'active') {
    throw new Error(`investigation ${change.operation} follows a terminal phase`)
  }
  if (next.revision !== current.revision + 1) {
    throw new Error(`investigation ${change.operation} must advance the revision by one`)
  }
  switch (change.operation) {
    case 'assess':
    case 'assess-failed': {
      if (next.phase !== 'active') throw new Error(`investigation ${change.operation} keeps the phase active`)
      if (next.attempts.length !== current.attempts.length + 1
        || next.budget.usedAttempts !== current.budget.usedAttempts + 1) {
        throw new Error(`investigation ${change.operation} appends exactly one attempt`)
      }
      const attempt = next.attempts[next.attempts.length - 1]
      const expected: AttemptOutcome = change.operation === 'assess' ? 'completed' : 'failed'
      if (attempt?.outcome !== expected) {
        throw new Error(`investigation ${change.operation} requires a ${expected} attempt`)
      }
      break
    }
    case 'finish':
      if (next.phase !== 'finished' || next.evidence.currentStatus !== 'satisfied') {
        throw new Error('investigation finish requires a finished phase with satisfied evidence')
      }
      break
    case 'stop-unknown':
      if (next.phase !== 'stopped-unknown') {
        throw new Error('investigation stop-unknown requires the stopped-unknown phase')
      }
      break
    /* v8 ignore start -- the caller excludes start and InvestigationOperation is closed; this arm retains fail-loud exhaustiveness */
    default:
      change.operation satisfies never
      throw new Error('unknown investigation operation')
    /* v8 ignore stop */
  }
  fold.current = next
}

/**
 * Apply one session event to the strict durable investigation fold.
 * @param fold - mutable fold accumulator.
 * @param event - next event in sequence order.
 */
export function applyInvestigationEvent(fold: InvestigationFoldState, event: SessionEvent): void {
  if (event.type !== 'investigation/change') return
  const change = decodeInvestigationChange(event.data)
  /* v8 ignore next -- the event's declared payload always identifies itself as an investigation change. */
  if (change === undefined) throw new Error(`investigation change at session event ${event.seq} has an invalid kind`)
  applyInvestigationChange(fold, change)
}

/**
 * Fold current investigation state from a contiguous session event log.
 * @param events - session events in sequence order.
 * @returns a fresh durable projection, or `undefined` before the first start.
 */
export function foldInvestigations(events: readonly SessionEvent[]): InvestigationState | undefined {
  const fold = emptyInvestigationFoldState()
  for (const event of events) applyInvestigationEvent(fold, event)
  return fold.current === undefined ? undefined : structuredClone(fold.current)
}
