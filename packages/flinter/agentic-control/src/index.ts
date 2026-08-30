export type AgenticControlIntent = 'run' | 'pause' | 'resume' | 'interrupt'
export type AgenticControlPhase = 'idle' | 'turn-active' | 'step-active' | 'interrupted' | 'completed'

export interface NativeControlEvent {
  readonly type: string
  readonly seq: number
  readonly data?: unknown
}

export interface AgenticControlContext {
  readonly organizationId: string
  readonly dshSessionId: string
  readonly executionRunId: string
}

export interface AgenticControlProjection {
  readonly organizationId: string
  readonly dshSessionId: string
  readonly executionRunId: string
  readonly highWatermarkSeq: number
  readonly phase: AgenticControlPhase
  readonly activeTurn?: number
  readonly activeStep?: number
}

export interface AgenticControlRequest {
  readonly intent: AgenticControlIntent
  readonly dshSessionId: string
  readonly expectedSeq: number
}

const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/

function identifier(value: string, label: string): string {
  if (!IDENTIFIER_RE.test(value)) throw new Error(`${label} must be an identifier`)
  return value
}

function eventNumber(event: NativeControlEvent, field: 'turn' | 'step'): number | undefined {
  if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return undefined
  const value = (event.data as Record<string, unknown>)[field]
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined
}

/**
 * Project native DSH lifecycle markers into a control-readable snapshot.
 * Payloads and unknown event data remain owned by DSH and are not copied.
 */
export function projectAgenticControl(
  context: AgenticControlContext,
  events: readonly NativeControlEvent[],
): AgenticControlProjection {
  identifier(context.organizationId, 'organizationId')
  identifier(context.dshSessionId, 'dshSessionId')
  identifier(context.executionRunId, 'executionRunId')
  let highWatermarkSeq = -1
  let phase: AgenticControlPhase = 'idle'
  let activeTurn: number | undefined
  let activeStep: number | undefined
  for (const event of events) {
    if (!Number.isSafeInteger(event.seq) || event.seq < 0 || event.seq <= highWatermarkSeq) {
      throw new Error('native control events must have strictly increasing non-negative seq values')
    }
    highWatermarkSeq = event.seq
    switch (event.type) {
      case 'turn/start':
        activeTurn = eventNumber(event, 'turn')
        activeStep = undefined
        phase = 'turn-active'
        break
      case 'step/start':
        activeStep = eventNumber(event, 'step')
        phase = 'step-active'
        break
      case 'step/end':
        activeStep = undefined
        phase = activeTurn === undefined ? 'idle' : 'turn-active'
        break
      case 'turn/end':
        activeTurn = undefined
        activeStep = undefined
        phase = 'completed'
        break
      case 'agent/interrupt':
        phase = 'interrupted'
        break
      default:
        // Unknown/plugin events are cursor-visible but not control-interpreted.
        break
    }
  }
  return Object.freeze({
    organizationId: context.organizationId,
    dshSessionId: context.dshSessionId,
    executionRunId: context.executionRunId,
    highWatermarkSeq,
    phase,
    ...(activeTurn === undefined ? {} : { activeTurn }),
    ...(activeStep === undefined ? {} : { activeStep }),
  })
}

/** Validate a control intent against the session and observed event cursor. */
export function validateAgenticControlRequest(
  request: AgenticControlRequest,
  context: AgenticControlContext,
  projection: AgenticControlProjection,
): AgenticControlRequest {
  identifier(request.dshSessionId, 'dshSessionId')
  if (request.dshSessionId !== context.dshSessionId || projection.dshSessionId !== context.dshSessionId) {
    throw new Error('control request session does not match the DSH context')
  }
  if (!Number.isSafeInteger(request.expectedSeq) || request.expectedSeq < 0) {
    throw new Error('expectedSeq must be a non-negative safe integer')
  }
  if (request.expectedSeq !== projection.highWatermarkSeq) {
    throw new Error('control request cursor is stale')
  }
  return Object.freeze({ ...request })
}
