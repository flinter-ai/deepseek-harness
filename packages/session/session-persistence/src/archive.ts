import { createHash } from 'node:crypto'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistenceRevision } from './revision.ts'

/** Maximum number of logical events returned by one archive page. */
export const MAX_ARCHIVE_PAGE_EVENTS = 1_024

/** A lossless event envelope for archival consumers, including unknown event types. */
export interface SessionArchiveEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
  readonly [key: string]: unknown
}

/** Immutable checkpoint identity for one canonical stored event prefix. */
export interface SessionArchiveSnapshot {
  readonly sessionId: SessionId
  readonly sourceRevision: SessionPersistenceRevision
  /** Inclusive final logical event sequence captured by this snapshot; `-1` means empty. */
  readonly highWatermarkSeq: number
  /** Opaque, serializable prefix validation token. */
  readonly opaquePrefixToken: string
}

/** One bounded page read from an archive snapshot. */
export interface SessionArchivePage {
  readonly events: SessionArchiveEvent[]
  readonly nextAfterSeq: number | null
  readonly sourceRevision: SessionPersistenceRevision
  readonly highWatermarkSeq: number
}

/** Stable failure returned when a captured archive prefix can no longer be trusted. */
export class SessionArchiveSnapshotStaleError extends Error {
  /** Stable machine-readable failure code for stale checkpoint consumers. */
  readonly code = 'STALE_SNAPSHOT' as const

  constructor(reason: string) {
    super(`STALE_SNAPSHOT: ${reason}`)
    this.name = 'SessionArchiveSnapshotStaleError'
  }
}

interface ArchiveToken {
  readonly version: 1
  readonly sessionId: string
  readonly sourceRevision: string
  readonly highWatermarkSeq: number
  readonly prefixHash: string
}

/**
 * Validate and detach stored events without applying the normal known-type policy.
 * @param events - logical events decoded by a persistence backend.
 * @param id - session identity used in failure diagnostics.
 * @returns detached archive envelopes, including unknown event types.
 */
export function snapshotArchiveEvents(
  events: readonly SessionEvent[],
  id: SessionId,
): SessionArchiveEvent[] {
  return events.map((event, index) => {
    if (typeof event !== 'object' || event === null) {
      throw new Error(`session "${id}" contains a non-object archival event at seq ${index}`)
    }
    const candidate = event as unknown as Record<string, unknown>
    if (typeof candidate.type !== 'string' || candidate.type.length === 0) {
      throw new Error(`session "${id}" contains an archival event with an invalid type at seq ${index}`)
    }
    if (candidate.seq !== index || !Number.isSafeInteger(candidate.seq) || candidate.seq < 0) {
      throw new Error(`session "${id}" contains a non-contiguous archival event at seq ${index}`)
    }
    if (!Number.isSafeInteger(candidate.time)) {
      throw new Error(`session "${id}" contains an archival event with an invalid time at seq ${index}`)
    }
    return structuredClone(candidate) as SessionArchiveEvent
  })
}

/**
 * Hash an ordered logical prefix without making JSON object key order significant.
 * @param events - the ordered archive event prefix.
 * @returns the lowercase SHA-256 digest of the canonical prefix.
 */
export function archivePrefixHash(events: readonly SessionArchiveEvent[]): string {
  return createHash('sha256').update(canonicalJson(events)).digest('hex')
}

/**
 * Create an opaque token that can be serialized and carried across process restarts.
 * @param sessionId - the checkpointed session identity.
 * @param sourceRevision - the persistence revision observed at checkpoint creation.
 * @param highWatermarkSeq - the inclusive final sequence in the captured prefix.
 * @param prefixHash - the canonical hash of the captured logical prefix.
 * @returns a base64url-encoded checkpoint token.
 */
export function encodeArchiveToken(
  sessionId: SessionId,
  sourceRevision: SessionPersistenceRevision,
  highWatermarkSeq: number,
  prefixHash: string,
): string {
  const token: ArchiveToken = {
    version: 1,
    sessionId,
    sourceRevision,
    highWatermarkSeq,
    prefixHash,
  }
  return Buffer.from(JSON.stringify(token), 'utf8').toString('base64url')
}

/**
 * Decode and validate the opaque token carried by one archive snapshot.
 * @param snapshot - the caller-supplied checkpoint to validate.
 * @returns the validated token claims.
 * @throws {@link SessionArchiveSnapshotStaleError} when the token is invalid.
 */
export function decodeArchiveToken(
  snapshot: SessionArchiveSnapshot,
): ArchiveToken {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(snapshot.opaquePrefixToken, 'base64url').toString('utf8'))
  } catch (error: unknown) {
    throw new SessionArchiveSnapshotStaleError(`invalid checkpoint token (${String(error)})`)
  }
  if (!isRecord(parsed)
    || parsed.version !== 1
    || parsed.sessionId !== snapshot.sessionId
    || parsed.sourceRevision !== snapshot.sourceRevision
    || parsed.highWatermarkSeq !== snapshot.highWatermarkSeq
    || !Number.isSafeInteger(parsed.highWatermarkSeq)
    || parsed.highWatermarkSeq < -1
    || typeof parsed.prefixHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(parsed.prefixHash)) {
    throw new SessionArchiveSnapshotStaleError('checkpoint token does not match its snapshot')
  }
  return parsed as unknown as ArchiveToken
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string': return JSON.stringify(value)
    case 'boolean': return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('archive event contains a non-finite number')
      return JSON.stringify(value)
    case 'object':
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
    default:
      throw new TypeError('archive event contains a non-JSON value')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
