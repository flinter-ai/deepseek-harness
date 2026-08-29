import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistenceRevision } from './revision.ts'
import type { SessionEventArchiveSegmentV1 } from './archive-segment.ts'

/**
 * The result of submitting one immutable archive segment to a sink.
 *
 * `ALREADY_PRESENT` is success: the sink already owns the exact same identity
 * and content. Callers must not treat it as a second copy or retry it with a
 * different identity.
 */
export type ArchiveSinkPutResult = 'STORED' | 'ALREADY_PRESENT'

/** Opaque control-plane fencing token attached to one archive write. */
export interface ArchiveFenceToken {
  /** The lease/attempt scope this token protects. */
  readonly scope: string
  /** Monotonically increasing generation within the scope. */
  readonly generation: number
  /** Opaque token value; never placed in logs or user-facing evidence. */
  readonly value: string
}

/**
 * The identity a sink compares before accepting a segment.
 *
 * A segment id is an idempotency key, not an authorization grant. The content
 * digests are retained in the identity so a reused id with different bytes is
 * a hard conflict rather than an overwrite.
 */
export interface ArchiveSegmentWrite {
  readonly segmentId: string
  readonly sessionId: SessionId
  readonly sourceRevision: SessionPersistenceRevision
  readonly highWatermarkSeq: number
  readonly payloadSha256: string
  readonly decodedEventStreamSha256: string
  readonly segment: SessionEventArchiveSegmentV1
}

/** Stable fail-closed sink failures required by ARCH-03. */
export type ArchiveSinkFailureCode =
  | 'ARCHIVE_FENCE_REJECTED'
  | 'ARCHIVE_IDENTITY_CONFLICT'

/** Error returned by a sink when a write cannot be accepted safely. */
export class ArchiveSinkError extends Error {
  constructor(
    readonly code: ArchiveSinkFailureCode,
    reason: string,
  ) {
    super(`${code}: ${reason}`)
    this.name = 'ArchiveSinkError'
  }
}

/**
 * Backend-neutral finalization contract for a future archive sink.
 *
 * The sink is the authority for finalization semantics, while the control
 * plane remains the authority for issuing and advancing fence tokens. A sink
 * MUST validate the fence before idempotency lookup, reject an older
 * generation after a newer writer has fenced it, and never overwrite an
 * accepted object. It MUST return `ALREADY_PRESENT` only when the complete
 * identity and both content digests match. A reused `segmentId` with any
 * mismatch is `ARCHIVE_IDENTITY_CONFLICT`.
 *
 * This is a contract-only seam. It does not register a runtime service, choose
 * B2/RDS, acquire leases, or imply cloud evidence.
 */
export interface SessionEventArchiveSink {
  put(
    write: ArchiveSegmentWrite,
    fence: ArchiveFenceToken,
  ): Promise<ArchiveSinkPutResult>
}
