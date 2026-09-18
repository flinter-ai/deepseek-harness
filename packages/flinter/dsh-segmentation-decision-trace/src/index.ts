/**
 * Producer adapter for FLINTER segmentation decision capture.
 *
 * Mounts one `DecisionTraceAdapter` on `ctx.flinterDecisionTrace` under the
 * exact name of an existing segmentation tool. The producer owns the
 * normalized request/result records; this package validates them fail-closed
 * and projects them into the bounded `SelectionProjection`/`ResultProjection`
 * allowlist. It never registers a tool, changes tool behavior or policy, adds
 * model-visible content, calls a provider, indexes data, or writes a
 * reasoning bank.
 *
 * @module @deepseek-ai/dsh-segmentation-decision-trace
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  DecisionRef,
  DecisionStatus,
  DecisionTraceAdapter,
  Disposition,
  ResultProjection,
  SelectionProjection,
} from '@deepseek-ai/dsh-decision-trace'
import type { SegmentationDecisionSource } from './types.ts'

export type {
  DecisionStatus,
  Disposition,
  SegmentationDecisionRequest,
  SegmentationDecisionResult,
  SegmentationDecisionSource,
} from './types.ts'

// Bounds mirror the capture contract in `@deepseek-ai/dsh-decision-trace`:
// a projection outside them would be rejected at the session boundary, so the
// adapter fails closed on the same limits before returning one.
const MAX_REFS = 32
const MAX_TEXT = 160
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/u
const OUTCOMES: readonly DecisionStatus[] = [
  'success',
  'rejection',
  'abstention',
  'unavailable-evidence',
  'malformed-response',
  'provider-error',
  'timeout',
  'exhaustion',
  'partial-retention',
  'export-conflict',
  'replay',
  'restart',
  'cancelled',
  'incomplete',
  'unknown',
]
const DISPOSITIONS: readonly Disposition[] = [
  'retained',
  'discarded',
  'abstained',
  'unavailable',
  'partial',
  'unknown',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function reference(value: unknown): DecisionRef {
  if (typeof value !== 'string' || !REFERENCE.test(value)) {
    throw new TypeError('invalid bounded reference')
  }
  return value
}

function references(value: unknown): DecisionRef[] {
  if (!Array.isArray(value) || value.length > MAX_REFS) {
    throw new RangeError('too many references')
  }
  const projected = value.map(reference)
  if (new Set(projected).size !== projected.length) {
    throw new TypeError('duplicate reference')
  }
  return projected
}

function optionalReferences(value: unknown): DecisionRef[] {
  return value === undefined ? [] : references(value)
}

function optionalNonNegativeInteger(value: unknown): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('invalid bounded number')
  }
  return value
}

/**
 * Validate one normalized request record and emit the bounded selection
 * projection. Only the allowlisted fields are read; unknown record fields are
 * never copied, so producer-local or sensitive values cannot escape.
 */
function projectSelection(record: unknown): SelectionProjection {
  if (!isRecord(record)) {
    throw new TypeError('invalid segmentation decision request')
  }
  const allowedActions = references(record.allowedActions)
  const chosenAction = reference(record.chosenAction)
  if (allowedActions.length === 0 || !allowedActions.includes(chosenAction)) {
    throw new TypeError('chosen action is not allowed')
  }
  return {
    allowedActions,
    chosenAction,
    parameterRefs: optionalReferences(record.parameterRefs),
    requestedEvidenceRefs: optionalReferences(record.requestedEvidenceRefs),
    fetchedEvidenceRefs: optionalReferences(record.fetchedEvidenceRefs),
    displayedEvidenceRefs: optionalReferences(record.displayedEvidenceRefs),
    observedEvidenceRefs: optionalReferences(record.observedEvidenceRefs),
    budgetBefore: optionalNonNegativeInteger(record.budgetBefore),
    candidateRefs: optionalReferences(record.candidateRefs),
    lineageRefs: optionalReferences(record.lineageRefs),
    sourceRef: reference(record.sourceRef),
    modelRef: reference(record.modelRef),
    policyRevisionRef: reference(record.policyRevisionRef),
  }
}

/**
 * Validate one normalized result record and emit the bounded result
 * projection. Missing usage, lineage, and readiness stay `null`, `'unknown'`,
 * and `false`; they are never inferred from the tool outcome.
 */
function projectResult(record: unknown): ResultProjection {
  if (!isRecord(record)) {
    throw new TypeError('invalid segmentation decision result')
  }
  const outcome = record.outcome as DecisionStatus
  const disposition = record.disposition as Disposition
  if (!OUTCOMES.includes(outcome)) throw new TypeError('invalid outcome')
  if (!DISPOSITIONS.includes(disposition)) throw new TypeError('invalid disposition')
  const lineageStatus = record.lineageStatus ?? 'unknown'
  const recordingReady = record.recordingReady ?? false
  const indexReady = record.indexReady ?? false
  if (lineageStatus !== 'known' && lineageStatus !== 'unknown') {
    throw new TypeError('invalid lineage status')
  }
  if (typeof recordingReady !== 'boolean' || typeof indexReady !== 'boolean') {
    throw new TypeError('invalid readiness')
  }
  return {
    outcome,
    usage: optionalNonNegativeInteger(record.usage),
    disposition,
    resultRefs: optionalReferences(record.resultRefs),
    evidenceRefs: optionalReferences(record.evidenceRefs),
    lineageStatus,
    recordingReady,
    indexReady,
  }
}

/**
 * Build the capture adapter that delegates fact extraction to the
 * producer-owned source and validates every record it returns.
 * @param source - producer-owned normalized resolvers.
 * @returns a `DecisionTraceAdapter` suitable for `ctx.flinterDecisionTrace.register`.
 * @throws TypeError when `source` lacks its `request`/`result` resolvers.
 */
export function createSegmentationDecisionAdapter(
  source: SegmentationDecisionSource,
): DecisionTraceAdapter {
  if (!isRecord(source)
    || typeof source.request !== 'function'
    || typeof source.result !== 'function') {
    throw new TypeError('invalid segmentation decision source')
  }
  return {
    projectSelection: exec => projectSelection(source.request(exec)),
    projectResult: (exec, result) => projectResult(source.result(exec, result)),
  }
}

/**
 * Plugin config: which existing tool to trace and the producer-owned source
 * that normalizes its executions. Not YAML-expressible — `source` carries
 * functions — so producers mount this plugin programmatically.
 */
export interface Config {
  /** Exact name of the existing segmentation tool to trace. */
  readonly toolName: string
  /** Producer-owned normalized decision resolvers. */
  readonly source: SegmentationDecisionSource
}

function resolveConfig(config: Config): Config {
  if (!isRecord(config) || typeof config.toolName !== 'string'
    || config.toolName.length === 0 || config.toolName.length > MAX_TEXT) {
    throw new TypeError('invalid segmentation decision trace config')
  }
  return config
}

/**
 * Register the adapter for `config.toolName` until the plugin fiber unloads.
 * The registration disposer is owned by the fiber through `ctx.effect`, so
 * disposal or hot reload removes exactly this adapter. A `function` plugin
 * cannot return it: Cordis constructs `apply` and discards the result.
 * @param ctx - Cordis context carrying the capture service.
 * @param config - exact tool name plus producer-owned resolvers.
 * @throws TypeError on invalid config or source, and the capture service's
 *   duplicate-registration error when the tool name is already claimed.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const adapter = createSegmentationDecisionAdapter(resolved.source)
  ctx.effect(
    () => ctx.flinterDecisionTrace.register(resolved.toolName, adapter),
    'flinterDecisionTrace.register()',
  )
}

/** Cordis plugin identity. */
export const name = 'flinter-segmentation-decision-trace'

/** Required service dependencies. */
export const inject = ['flinterDecisionTrace']
