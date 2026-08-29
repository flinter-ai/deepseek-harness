import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  ArchiveSinkError,
  type ArchiveFenceToken,
  type ArchiveSegmentWrite,
  type SessionEventArchiveSink,
} from '../src/index.ts'
import type { SessionEventArchiveSegmentV1 } from '../src/index.ts'

const segment = {
  kind: 'SessionEventArchiveSegmentV1',
  version: 1,
  sessionId: SessionId('sink-contract-session'),
  sourceRevision: 'revision-1',
  highWatermarkSeq: 0,
  firstSeq: 0,
  lastSeq: 0,
  eventCount: 1,
  compression: 'zstd',
  payloadSha256: 'a'.repeat(64),
  decodedEventStreamSha256: 'b'.repeat(64),
  payloadBase64: 'payload',
} as unknown as SessionEventArchiveSegmentV1

const write: ArchiveSegmentWrite = {
  segmentId: 'segment-1',
  sessionId: segment.sessionId,
  sourceRevision: segment.sourceRevision,
  highWatermarkSeq: segment.highWatermarkSeq,
  payloadSha256: segment.payloadSha256,
  decodedEventStreamSha256: segment.decodedEventStreamSha256,
  segment,
}

function fence(generation: number, value = `fence-${generation}`): ArchiveFenceToken {
  return { scope: 'worker-attempt', generation, value }
}

/** Test-only model of the sink rules; no production backend is introduced. */
class ContractSink implements SessionEventArchiveSink {
  private currentGeneration = 0
  private readonly accepted = new Map<string, ArchiveSegmentWrite>()

  advanceFence(generation: number): void {
    if (generation <= this.currentGeneration) throw new Error('test fence must advance')
    this.currentGeneration = generation
  }

  async put(next: ArchiveSegmentWrite, token: ArchiveFenceToken) {
    if (token.generation < this.currentGeneration) {
      throw new ArchiveSinkError('ARCHIVE_FENCE_REJECTED', 'writer fence is stale')
    }
    if (token.generation > this.currentGeneration) this.currentGeneration = token.generation
    const previous = this.accepted.get(next.segmentId)
    if (previous === undefined) {
      this.accepted.set(next.segmentId, next)
      return 'STORED' as const
    }
    if (sameIdentity(previous, next)) return 'ALREADY_PRESENT' as const
    throw new ArchiveSinkError('ARCHIVE_IDENTITY_CONFLICT', 'segment id was reused with different content')
  }
}

function sameIdentity(left: ArchiveSegmentWrite, right: ArchiveSegmentWrite): boolean {
  return left.sessionId === right.sessionId
    && left.sourceRevision === right.sourceRevision
    && left.highWatermarkSeq === right.highWatermarkSeq
    && left.payloadSha256 === right.payloadSha256
    && left.decodedEventStreamSha256 === right.decodedEventStreamSha256
}

describe('ARCH-03 archive sink contract', () => {
  it('treats exact repeated identity as an idempotent success', async () => {
    const sink = new ContractSink()
    await expect(sink.put(write, fence(1))).resolves.toBe('STORED')
    await expect(sink.put(write, fence(1))).resolves.toBe('ALREADY_PRESENT')
  })

  it('rejects a reused segment id with a different content digest', async () => {
    const sink = new ContractSink()
    await sink.put(write, fence(1))
    await expect(sink.put({ ...write, payloadSha256: 'c'.repeat(64) }, fence(1)))
      .rejects.toMatchObject({ code: 'ARCHIVE_IDENTITY_CONFLICT' })
  })

  it('fences an older writer before idempotency lookup', async () => {
    const sink = new ContractSink()
    await sink.put(write, fence(1))
    sink.advanceFence(2)
    await expect(sink.put(write, fence(1))).rejects.toMatchObject({ code: 'ARCHIVE_FENCE_REJECTED' })
    await expect(sink.put(write, fence(2))).resolves.toBe('ALREADY_PRESENT')
  })

  it('keeps same session and sequence metadata in the identity comparison', async () => {
    const sink = new ContractSink()
    await sink.put(write, fence(1))
    await expect(sink.put({ ...write, highWatermarkSeq: 1 }, fence(1)))
      .rejects.toMatchObject({ code: 'ARCHIVE_IDENTITY_CONFLICT' })
  })
})
