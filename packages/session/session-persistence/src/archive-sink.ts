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
  /** Monotonically increasing safe-integer generation within the scope. */
  readonly generation: number
  /**
   * Opaque token value for the exact generation; never placed in logs or
   * user-facing evidence. A different value at the same generation is a
   * different fence and must not be accepted as the current writer.
   */
  readonly value: string
}

/**
 * The identity a sink compares before accepting a segment.
 *
 * A segment id is an idempotency key, not an authorization grant. The encoded
 * segment carries the complete immutable identity and content digests, so a
 * reused id with different bytes is a hard conflict rather than an overwrite.
 */
export interface ArchiveSegmentWrite {
  readonly segmentId: string
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
 * MUST validate the fence before idempotency lookup, reject an older writer
 * generation after a newer writer has fenced it, and never overwrite an
 * accepted object. Fence state is per `scope`; an equal generation with a
 * different `value` is also stale. Fence validation, idempotency lookup, and
 * first-write publication MUST be one atomic conditional operation in the
 * backend. It MUST return `ALREADY_PRESENT` only when the segment id and every
 * immutable field of the encoded segment match. A reused `segmentId` with any
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
