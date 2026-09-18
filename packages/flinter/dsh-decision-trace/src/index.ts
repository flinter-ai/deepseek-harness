/**
 * Bounded, failure-inclusive, log-only FLINTER decision capture.
 *
 * @module @deepseek-ai/dsh-decision-trace
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  PreToolDecision,
  ToolExecution,
  ToolExecutionResult,
} from '@deepseek-ai/dsh-tools'
import type {
  DecisionId,
  DecisionEpisode,
  DecisionResultEvent,
  DecisionSelectionEvent,
  DecisionStatus,
  DecisionTraceAdapter,
  Disposition,
  ResultProjection,
  SelectionProjection,
} from './types.ts'

export type {
  DecisionEpisode,
  DecisionRef,
  DecisionResultEvent,
  DecisionSelectionEvent,
  DecisionStatus,
  DecisionTraceAdapter,
  Disposition,
  ResultProjection,
  SelectionProjection,
} from './types.ts'

/**
 * Brand a decision identity after validation or deterministic construction.
 * @param id - validated durable decision identity.
 * @returns the same string with the decision identity brand.
 */
export function DecisionId(id: string): DecisionId {
  return id as DecisionId
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Registration and bounded diagnostics for FLINTER decision capture. */
    flinterDecisionTrace: DecisionTraceService
  }
}

const MAX_REFS = 32
const MAX_TEXT = 160
const MAX_DECISION_ID = 400
const MAX_DIAGNOSTICS = 128
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

type DiagnosticCode =
  | 'selection:projection-failed'
  | 'result:projection-failed'

function boundedText(value: unknown, label: string, maximum = MAX_TEXT): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(`invalid bounded ${label}`)
  }
  return value
}

function decisionId(value: unknown): DecisionId {
  const id = boundedText(value, 'decision id', MAX_DECISION_ID)
  if (!id.startsWith('flinter-decision:')) throw new TypeError('invalid decision id')
  return DecisionId(id)
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !REFERENCE.test(value)) {
    throw new TypeError('invalid bounded reference')
  }
  return value
}

function references(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_REFS) {
    throw new RangeError('too many references')
  }
  const projected = value.map(reference)
  if (new Set(projected).size !== projected.length) {
    throw new TypeError('duplicate reference')
  }
  return projected
}

function nonNegativeInteger(value: unknown): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('invalid bounded number')
  }
  return value
}

function selectionProjection(value: unknown): SelectionProjection {
  const candidate = value as Record<string, unknown>
  const allowedActions = references(candidate.allowedActions)
  const chosenAction = reference(candidate.chosenAction)
  if (allowedActions.length === 0 || !allowedActions.includes(chosenAction)) {
    throw new TypeError('chosen action is not allowed')
  }
  return {
    allowedActions,
    chosenAction,
    parameterRefs: references(candidate.parameterRefs),
    requestedEvidenceRefs: references(candidate.requestedEvidenceRefs),
    fetchedEvidenceRefs: references(candidate.fetchedEvidenceRefs),
    displayedEvidenceRefs: references(candidate.displayedEvidenceRefs),
    observedEvidenceRefs: references(candidate.observedEvidenceRefs),
    budgetBefore: nonNegativeInteger(candidate.budgetBefore),
    candidateRefs: references(candidate.candidateRefs),
    lineageRefs: references(candidate.lineageRefs),
    sourceRef: reference(candidate.sourceRef),
    modelRef: reference(candidate.modelRef),
    policyRevisionRef: reference(candidate.policyRevisionRef),
  }
}

function resultProjection(value: unknown): ResultProjection {
  const candidate = value as Record<string, unknown>
  const outcome = candidate.outcome as DecisionStatus
  const disposition = candidate.disposition as Disposition
  if (!OUTCOMES.includes(outcome)) throw new TypeError('invalid outcome')
  if (!DISPOSITIONS.includes(disposition)) throw new TypeError('invalid disposition')
  const lineageStatus = candidate.lineageStatus
  if (lineageStatus !== 'known' && lineageStatus !== 'unknown') {
    throw new TypeError('invalid lineage status')
  }
  if (typeof candidate.recordingReady !== 'boolean' || typeof candidate.indexReady !== 'boolean') {
    throw new TypeError('invalid readiness')
  }
  return {
    outcome,
    usage: nonNegativeInteger(candidate.usage),
    disposition,
    resultRefs: references(candidate.resultRefs),
    evidenceRefs: references(candidate.evidenceRefs),
    lineageStatus,
    recordingReady: candidate.recordingReady,
    indexReady: candidate.indexReady,
  }
}

function stableDecisionId(exec: Readonly<ToolExecution>, ownerSessionId: unknown): DecisionId {
  const sessionId = boundedText(ownerSessionId, 'session id')
  const callId = boundedText(String(exec.callId), 'call id')
  return DecisionId(`flinter-decision:${sessionId.length}:${sessionId}${callId.length}:${callId}`)
}

function validateSelectionEvent(value: unknown): DecisionSelectionEvent {
  const candidate = value as Record<string, unknown>
  if (candidate.phase !== 'selection') throw new TypeError('invalid selection phase')
  return {
    decisionId: decisionId(candidate.decisionId),
    callId: boundedText(candidate.callId, 'call id'),
    toolName: boundedText(candidate.toolName, 'tool name'),
    phase: 'selection',
    projection: selectionProjection(candidate.projection),
  }
}

function validateResultEvent(value: unknown): DecisionResultEvent {
  const candidate = value as Record<string, unknown>
  if (candidate.phase !== 'result') throw new TypeError('invalid result phase')
  return {
    decisionId: decisionId(candidate.decisionId),
    callId: boundedText(candidate.callId, 'call id'),
    toolName: boundedText(candidate.toolName, 'tool name'),
    phase: 'result',
    projection: resultProjection(candidate.projection),
  }
}

/** Registry used by producer plugins to opt exact tool names into capture. */
export class DecisionTraceService {
  private readonly adapters = new Map<string, DecisionTraceAdapter>()
  private readonly diagnosticCodes: DiagnosticCode[] = []

  /** Bounded diagnostic codes; adapter data and thrown text are never retained. */
  get diagnostics(): readonly DiagnosticCode[] {
    return this.diagnosticCodes
  }

  /**
   * Register one exact tool-name adapter until the returned disposer runs.
   * @param toolName - exact DSH tool name owned by the producer.
   * @param adapter - trusted same-process projection callbacks.
   * @returns a disposer that removes this registration when it still owns the name.
   */
  register(toolName: string, adapter: DecisionTraceAdapter): () => void {
    boundedText(toolName, 'tool name')
    if (this.adapters.has(toolName)) {
      throw new Error(`duplicate adapter registration: ${toolName}`)
    }
    this.adapters.set(toolName, adapter)
    return () => {
      if (this.adapters.get(toolName) === adapter) this.adapters.delete(toolName)
    }
  }

  /**
   * Find the adapter registered for one exact tool name.
   * @param toolName - exact DSH tool name.
   * @returns its adapter, or undefined when capture is not enabled.
   */
  adapter(toolName: string): DecisionTraceAdapter | undefined {
    return this.adapters.get(toolName)
  }

  /**
   * Record one bounded internal failure code without thrown data.
   * @param code - closed diagnostic code selected by the capture observer.
   */
  recordDiagnostic(code: DiagnosticCode): void {
    if (this.diagnosticCodes.length < MAX_DIAGNOSTICS) this.diagnosticCodes.push(code)
  }
}

/**
 * Fold durable selection/result events into deterministic replay episodes.
 * @param events - a complete or partial session event sequence.
 * @returns first-seen decision episodes with exact duplicates removed.
 * @throws when durable projections are invalid or an immutable identity changes.
 */
export function foldDecisionEpisodes(events: readonly SessionEvent[]): DecisionEpisode[] {
  const byId = new Map<DecisionId, DecisionEpisode>()
  const fingerprints = new Map<string, string>()

  for (const event of events) {
    if (event.type !== 'flinter/decision-selection' && event.type !== 'flinter/decision-result') continue
    const data = event.type === 'flinter/decision-selection'
      ? validateSelectionEvent(event.data)
      : validateResultEvent(event.data)
    const current = byId.get(data.decisionId)
    if (current !== undefined && (
      current.callId !== data.callId
      || current.toolName !== data.toolName
    )) {
      throw new Error(`immutable decision pair identity conflict: ${data.decisionId}`)
    }

    const key = `${data.decisionId}:${data.phase}`
    const fingerprint = JSON.stringify(data)
    const previous = fingerprints.get(key)
    if (previous !== undefined) {
      if (previous !== fingerprint) {
        throw new Error(`immutable decision identity conflict: ${data.decisionId}`)
      }
      continue
    }
    fingerprints.set(key, fingerprint)

    const episode = current ?? {
      decisionId: data.decisionId,
      callId: data.callId,
      toolName: data.toolName,
      status: 'incomplete',
    }
    if (data.phase === 'selection') episode.selection = data
    else episode.result = data
    episode.status = episode.selection !== undefined && episode.result !== undefined
      ? episode.result.projection.outcome
      : 'incomplete'
    byId.set(data.decisionId, episode)
  }

  return [...byId.values()]
}

/** Mount the opt-in capture service and log-only ToolRuntime observers. */
export function apply(ctx: Context): void {
  const service = new DecisionTraceService()
  ctx.provide('flinterDecisionTrace', service)
  ctx.on('tools/pre-execute', (
    exec: ToolExecution,
    next: () => Promise<PreToolDecision>,
  ) => {
    const adapter = exec.agent === undefined ? undefined : service.adapter(exec.name)
    if (adapter !== undefined && exec.agent !== undefined) {
      try {
        const data: DecisionSelectionEvent = {
          decisionId: stableDecisionId(exec, exec.agent.session.id),
          callId: boundedText(String(exec.callId), 'call id'),
          toolName: boundedText(exec.name, 'tool name'),
          phase: 'selection',
          projection: selectionProjection(adapter.projectSelection(exec)),
        }
        exec.agent.session.append('flinter/decision-selection', data)
      } catch {
        service.recordDiagnostic('selection:projection-failed')
      }
    }
    return next()
  }, { prepend: true })
  ctx.on('tools/result', (
    exec: Readonly<ToolExecution>,
    value: Readonly<ToolExecutionResult>,
  ) => {
    const adapter = exec.agent === undefined ? undefined : service.adapter(exec.name)
    if (adapter === undefined || exec.agent === undefined) return
    try {
      const data: DecisionResultEvent = {
        decisionId: stableDecisionId(exec, exec.agent.session.id),
        callId: boundedText(String(exec.callId), 'call id'),
        toolName: boundedText(exec.name, 'tool name'),
        phase: 'result',
        projection: resultProjection(adapter.projectResult(exec, value)),
      }
      exec.agent.session.append('flinter/decision-result', data)
    } catch {
      service.recordDiagnostic('result:projection-failed')
    }
  })
}

/** Cordis plugin identity. */
export const name = 'flinter-decision-trace'

/** Required service dependencies. */
export const inject = ['tools']
