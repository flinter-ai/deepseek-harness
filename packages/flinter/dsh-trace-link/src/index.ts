import type { SessionEvent } from '@deepseek-ai/dsh-session'

export const TRACE_LINK_SCHEMA_VERSION = 'flinter.trace-link.v1' as const
export const TRACE_LINK_KIND = 'dsh_session_event_to_execution' as const

export interface FlinterExecutionContext {
  readonly organizationId: string
  readonly dshSessionId: string
  readonly executionRunId: string
}

export interface TraceLinkMetadata {
  readonly linkId: string
  readonly executionRecordId?: string | null
  readonly producer: string
  readonly producerVersion: string
  readonly codeVersion: string
}

export interface TraceLinkV1 {
  readonly schema_version: typeof TRACE_LINK_SCHEMA_VERSION
  readonly link_id: string
  readonly link_kind: typeof TRACE_LINK_KIND
  readonly organization_id: string
  readonly dsh_session_id: string
  readonly dsh_event_seq: number
  readonly execution_run_id: string
  readonly execution_record_id: string | null
  readonly producer: string
  readonly producer_version: string
  readonly code_version: string
}

export interface DshSessionEventReference {
  readonly sessionId: string
  readonly seq: number
}

const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/
const VERSION_RE = /^\S{1,256}$/u

function assertIdentifier(value: string, label: string): string {
  if (!IDENTIFIER_RE.test(value)) throw new Error(`${label} must be an identifier`)
  return value
}

function assertVersion(value: string, label: string): string {
  if (!VERSION_RE.test(value)) throw new Error(`${label} must be a non-empty version token`)
  return value
}

function assertEventReference(value: DshSessionEventReference): DshSessionEventReference {
  if (Object.keys(value).some(key => key !== 'sessionId' && key !== 'seq')) {
    throw new Error('DSH SessionEvent reference may contain only sessionId and seq')
  }
  assertIdentifier(value.sessionId, 'sessionId')
  if (!Number.isSafeInteger(value.seq) || value.seq < 0) throw new Error('seq must be a non-negative safe integer')
  return value
}

/** Project a native event to the only two fields allowed across this seam. */
export function referenceFromSessionEvent(event: Pick<SessionEvent, 'seq'> & { sessionId: string }): DshSessionEventReference {
  return Object.freeze(assertEventReference({ sessionId: event.sessionId, seq: event.seq }))
}

/** Build a strict metadata-only link; DSH event payload never enters the result. */
export function traceLinkFromSessionEvent(
  event: DshSessionEventReference,
  context: FlinterExecutionContext,
  metadata: TraceLinkMetadata,
): TraceLinkV1 {
  const reference = assertEventReference(event)
  assertIdentifier(context.organizationId, 'organizationId')
  assertIdentifier(context.dshSessionId, 'dshSessionId')
  assertIdentifier(context.executionRunId, 'executionRunId')
  assertIdentifier(metadata.linkId, 'linkId')
  assertIdentifier(metadata.producer, 'producer')
  assertVersion(metadata.producerVersion, 'producerVersion')
  assertVersion(metadata.codeVersion, 'codeVersion')
  if (context.dshSessionId !== reference.sessionId) {
    throw new Error('DSH session reference does not match execution context')
  }
  if (metadata.executionRecordId !== undefined && metadata.executionRecordId !== null) {
    assertIdentifier(metadata.executionRecordId, 'executionRecordId')
  }
  return Object.freeze({
    schema_version: TRACE_LINK_SCHEMA_VERSION,
    link_id: metadata.linkId,
    link_kind: TRACE_LINK_KIND,
    organization_id: context.organizationId,
    dsh_session_id: context.dshSessionId,
    dsh_event_seq: reference.seq,
    execution_run_id: context.executionRunId,
    execution_record_id: metadata.executionRecordId ?? null,
    producer: metadata.producer,
    producer_version: metadata.producerVersion,
    code_version: metadata.codeVersion,
  })
}
