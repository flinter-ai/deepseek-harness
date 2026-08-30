import { createHash } from 'node:crypto'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { canonicalArchiveJson } from './archive-json.ts'
import type { SessionPersistenceRevision } from './revision.ts'
import type { SessionArchiveEvent, SessionArchiveSnapshot } from './archive.ts'

/** The only segment format version accepted by this local archive codec. */
export const SESSION_EVENT_ARCHIVE_SEGMENT_VERSION = 1 as const

/** Maximum compressed payload accepted by the local codec before decompression. */
export const MAX_SESSION_EVENT_ARCHIVE_PAYLOAD_BYTES = 16 * 1024 * 1024

/** Canonical local archive segment containing one complete DSH event prefix. */
export interface SessionEventArchiveSegmentV1 {
  readonly kind: 'SessionEventArchiveSegmentV1'
  readonly version: typeof SESSION_EVENT_ARCHIVE_SEGMENT_VERSION
  readonly sessionId: SessionId
  readonly sourceRevision: SessionPersistenceRevision
  readonly highWatermarkSeq: number
  readonly firstSeq: number
  readonly lastSeq: number
  readonly eventCount: number
  readonly compression: 'zstd'
  readonly payloadSha256: string
  readonly decodedEventStreamSha256: string
  readonly payloadBase64: string
}

/** Result of decoding and validating one local archive segment. */
export interface DecodedSessionEventArchiveSegmentV1 {
  readonly segment: SessionEventArchiveSegmentV1
  readonly events: SessionArchiveEvent[]
}

/**
 * Encode a checkpoint prefix as canonical JSONL compressed with checksummed Zstandard.
 * @param snapshot The immutable archive checkpoint that bounds the event prefix.
 * @param events The ordered canonical events from sequence zero through the HWM.
 * @returns A versioned, checksummed archive segment ready for local persistence.
 */
export function encodeSessionEventArchiveSegmentV1(
  snapshot: SessionArchiveSnapshot,
  events: readonly SessionArchiveEvent[],
): SessionEventArchiveSegmentV1 {
  const detached = validateEvents(snapshot.sessionId, snapshot.highWatermarkSeq, events)
  const decodedEventStream = canonicalEventStream(detached)
  const decodedBytes = Buffer.from(decodedEventStream, 'utf8')
  const payload = zstdCompressSync(decodedBytes)
  /* v8 ignore next -- the same capacity guard is covered on decode; this protects callers that construct segments locally. */
  if (payload.byteLength > MAX_SESSION_EVENT_ARCHIVE_PAYLOAD_BYTES) {
    throw new RangeError(`archive payload exceeds ${MAX_SESSION_EVENT_ARCHIVE_PAYLOAD_BYTES} bytes`)
  }
  const firstSeq = detached[0]?.seq ?? -1
  const lastSeq = detached.at(-1)?.seq ?? -1
  return {
    kind: 'SessionEventArchiveSegmentV1',
    version: SESSION_EVENT_ARCHIVE_SEGMENT_VERSION,
    sessionId: snapshot.sessionId,
    sourceRevision: snapshot.sourceRevision,
    highWatermarkSeq: snapshot.highWatermarkSeq,
    firstSeq,
    lastSeq,
    eventCount: detached.length,
    compression: 'zstd',
    payloadSha256: sha256(payload),
    decodedEventStreamSha256: sha256(decodedBytes),
    payloadBase64: payload.toString('base64'),
  }
}

/**
 * Decode a local archive segment, checking payload, event order, HWM, and stream hashes.
 * @param segment The versioned archive segment to validate and decode.
 * @returns The validated segment and its lossless canonical event stream.
 */
export function decodeSessionEventArchiveSegmentV1(
  segment: unknown,
): DecodedSessionEventArchiveSegmentV1 {
  validateSegmentMetadata(segment)
  const payload = decodeBase64Payload(segment.payloadBase64)
  if (payload.byteLength > MAX_SESSION_EVENT_ARCHIVE_PAYLOAD_BYTES) {
    throw new RangeError(`archive payload exceeds ${MAX_SESSION_EVENT_ARCHIVE_PAYLOAD_BYTES} bytes`)
  }
  if (sha256(payload) !== segment.payloadSha256) {
    throw new Error('archive payload SHA-256 mismatch')
  }
  let decodedBytes: Buffer
  try {
    decodedBytes = zstdDecompressSync(payload)
  } catch (error: unknown) {
    throw new Error(`archive payload is not valid Zstandard: ${String(error)}`)
  }
  if (sha256(decodedBytes) !== segment.decodedEventStreamSha256) {
    throw new Error('archive decoded event-stream SHA-256 mismatch')
  }
  const text = decodedBytes.toString('utf8')
  const events = text.length === 0
    ? []
    : text.endsWith('\n')
      ? text.slice(0, -1).split('\n').map(parseEvent)
      : (() => { throw new Error('archive decoded event stream is missing its final newline') })()
  const detached = validateEvents(segment.sessionId, segment.highWatermarkSeq, events)
  if (detached.length !== segment.eventCount
    || (detached[0]?.seq ?? -1) !== segment.firstSeq
    || (detached.at(-1)?.seq ?? -1) !== segment.lastSeq) {
    throw new Error('archive segment event metadata does not match its payload')
  }
  return { segment, events: detached }
}

function decodeBase64Payload(value: string): Buffer {
  // Buffer.from(..., 'base64') is intentionally permissive and silently
  // discards malformed characters. Archive inputs must be canonical so a
  // corrupt transport cannot be reinterpreted as a different payload.
  if (value.length % 4 !== 0) {
    throw new Error('archive payload is not valid base64')
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const estimatedBytes = (value.length / 4) * 3 - padding
  if (estimatedBytes > MAX_SESSION_EVENT_ARCHIVE_PAYLOAD_BYTES) {
    throw new RangeError(`archive payload exceeds ${MAX_SESSION_EVENT_ARCHIVE_PAYLOAD_BYTES} bytes`)
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('archive payload is not valid base64')
  }
  const payload = Buffer.from(value, 'base64')
  if (payload.toString('base64') !== value) {
    throw new Error('archive payload is not valid base64')
  }
  return payload
}

function validateEvents(
  sessionId: SessionId,
  highWatermarkSeq: number,
  events: readonly unknown[],
): SessionArchiveEvent[] {
  if (!Number.isSafeInteger(highWatermarkSeq) || highWatermarkSeq < -1) {
    throw new TypeError('archive highWatermarkSeq must be a safe integer >= -1')
  }
  const detached = events.map((event, index) => {
    if (typeof event !== 'object' || event === null || Array.isArray(event)) {
      throw new TypeError(`archive session "${sessionId}" event at index ${index} is not an object`)
    }
    const candidate = event as Record<string, unknown>
    if (typeof candidate.type !== 'string' || candidate.type.length === 0
      || !Number.isSafeInteger(candidate.seq) || candidate.seq !== index
      || !Number.isSafeInteger(candidate.time)) {
      throw new TypeError(`archive session "${sessionId}" event at index ${index} has an invalid envelope`)
    }
    return structuredClone(candidate) as SessionArchiveEvent
  })
  const lastSeq = detached.at(-1)?.seq ?? -1
  if (lastSeq !== highWatermarkSeq) {
    throw new Error(`archive prefix ends at seq ${lastSeq}, expected highWatermarkSeq ${highWatermarkSeq}`)
  }
  return detached
}

function validateSegmentMetadata(segment: unknown): asserts segment is SessionEventArchiveSegmentV1 {
  if (typeof segment !== 'object' || segment === null || Array.isArray(segment)) {
    throw new TypeError('invalid SessionEventArchiveSegmentV1 metadata')
  }
  const candidate = segment as Record<string, unknown>
  if (candidate.kind !== 'SessionEventArchiveSegmentV1'
    || candidate.version !== SESSION_EVENT_ARCHIVE_SEGMENT_VERSION
    || candidate.compression !== 'zstd'
    || !Number.isSafeInteger(candidate.highWatermarkSeq)
    || !Number.isSafeInteger(candidate.firstSeq)
    || !Number.isSafeInteger(candidate.lastSeq)
    || !Number.isSafeInteger(candidate.eventCount)
    || (candidate.eventCount as number) < 0
    || typeof candidate.payloadSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(candidate.payloadSha256)
    || typeof candidate.decodedEventStreamSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(candidate.decodedEventStreamSha256)
    || typeof candidate.payloadBase64 !== 'string') {
    throw new TypeError('invalid SessionEventArchiveSegmentV1 metadata')
  }
}

function canonicalEventStream(events: readonly SessionArchiveEvent[]): string {
  return events.map(event => canonicalArchiveJson(event)).join('\n') + (events.length > 0 ? '\n' : '')
}

function parseEvent(line: string): SessionArchiveEvent {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (error: unknown) {
    throw new Error(`archive event line is not valid JSON: ${String(error)}`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('archive event line is not an object')
  }
  return value as SessionArchiveEvent
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
