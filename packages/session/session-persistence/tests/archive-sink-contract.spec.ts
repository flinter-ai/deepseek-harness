import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  ArchiveSinkError,
  decodeSessionEventArchiveSegmentV1,
  encodeSessionEventArchiveSegmentV1,
  SessionPersistenceRevision,
  type ArchiveFenceToken,
  type ArchiveSegmentWrite,
  type SessionArchiveEvent,
  type SessionEventArchiveSegmentV1,
  type SessionEventArchiveSink,
} from '../src/index.ts'

const defaultEvents: readonly SessionArchiveEvent[] = [
  { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
]

function makeSegment(events: readonly SessionArchiveEvent[] = defaultEvents): SessionEventArchiveSegmentV1 {
  return encodeSessionEventArchiveSegmentV1(
    {
      sessionId: SessionId('sink-contract-session'),
      sourceRevision: SessionPersistenceRevision('revision-1'),
      highWatermarkSeq: events.at(-1)?.seq ?? -1,
      opaquePrefixToken: 'prefix-token',
    },
    events,
  )
}

const segment = makeSegment()
const write: ArchiveSegmentWrite = { segmentId: 'segment-1', segment }

function fence(
  generation: number,
  scope = 'worker-attempt',
  value = `${scope}-${generation}`,
): ArchiveFenceToken {
  return { scope, generation, value }
}

/** Test-only model of the sink rules; no production backend is introduced. */
class ContractSink implements SessionEventArchiveSink {
  private readonly currentFences = new Map<string, ArchiveFenceToken>()
  private readonly accepted = new Map<string, ArchiveSegmentWrite>()

  advanceFence(token: ArchiveFenceToken): void {
    assertFence(token)
    const current = this.currentFences.get(token.scope)
    if (current !== undefined && token.generation <= current.generation) {
      throw new Error('test fence must advance')
    }
    this.currentFences.set(token.scope, { ...token })
  }

  async put(next: ArchiveSegmentWrite, token: ArchiveFenceToken) {
    assertFence(token)
    const current = this.currentFences.get(token.scope)
    if (current !== undefined
      && (token.generation < current.generation
        || (token.generation === current.generation && token.value !== current.value))) {
      throw new ArchiveSinkError('ARCHIVE_FENCE_REJECTED', 'writer fence is stale')
    }

    // The backend must validate the ARCH-02 segment before making a fence or
    // idempotency decision. An invalid segment cannot consume a newer fence.
    decodeSessionEventArchiveSegmentV1(next.segment)
    if (current === undefined || token.generation > current.generation) {
      this.currentFences.set(token.scope, { ...token })
    }

    const previous = this.accepted.get(next.segmentId)
    if (previous === undefined) {
      this.accepted.set(next.segmentId, next)
      return 'STORED' as const
    }
    if (sameIdentity(previous, next)) return 'ALREADY_PRESENT' as const
    throw new ArchiveSinkError('ARCHIVE_IDENTITY_CONFLICT', 'segment id was reused with different content')
  }
}

function assertFence(token: ArchiveFenceToken): void {
  if (typeof token.scope !== 'string' || token.scope.length === 0
    || !Number.isSafeInteger(token.generation) || token.generation < 0
    || typeof token.value !== 'string' || token.value.length === 0) {
    throw new TypeError('invalid archive fence token')
  }
}

function sameIdentity(left: ArchiveSegmentWrite, right: ArchiveSegmentWrite): boolean {
  const a = left.segment
  const b = right.segment
  return left.segmentId === right.segmentId
    && a.kind === b.kind
    && a.version === b.version
    && a.sessionId === b.sessionId
    && a.sourceRevision === b.sourceRevision
    && a.highWatermarkSeq === b.highWatermarkSeq
    && a.firstSeq === b.firstSeq
    && a.lastSeq === b.lastSeq
    && a.eventCount === b.eventCount
    && a.compression === b.compression
    && a.payloadSha256 === b.payloadSha256
    && a.decodedEventStreamSha256 === b.decodedEventStreamSha256
    && a.payloadBase64 === b.payloadBase64
}

describe('ARCH-03 archive sink contract', () => {
  it('treats exact repeated identity as an idempotent success', async () => {
    const sink = new ContractSink()
    await expect(sink.put(write, fence(1))).resolves.toBe('STORED')
    await expect(sink.put(write, fence(1))).resolves.toBe('ALREADY_PRESENT')
  })

  it('rejects a reused segment id with different encoded bytes', async () => {
    const sink = new ContractSink()
    const different: ArchiveSegmentWrite = {
      segmentId: write.segmentId,
      segment: makeSegment([{ type: 'turn/start', seq: 0, time: 1, data: { turn: 2 } }]),
    }
    await sink.put(write, fence(1))
    await expect(sink.put(different, fence(1)))
      .rejects.toMatchObject({ code: 'ARCHIVE_IDENTITY_CONFLICT' })
  })

  it('fences an older writer before idempotency lookup', async () => {
    const sink = new ContractSink()
    await sink.put(write, fence(1))
    sink.advanceFence(fence(2))
    await expect(sink.put(write, fence(1))).rejects.toMatchObject({ code: 'ARCHIVE_FENCE_REJECTED' })
    await expect(sink.put(write, fence(2))).resolves.toBe('ALREADY_PRESENT')
  })

  it('rejects a different fence value at the same generation', async () => {
    const sink = new ContractSink()
    await sink.put(write, fence(1))
    await expect(sink.put(write, fence(1, 'worker-attempt', 'replayed-value')))
      .rejects.toMatchObject({ code: 'ARCHIVE_FENCE_REJECTED' })
  })

  it('keeps fencing state independent for different scopes', async () => {
    const sink = new ContractSink()
    await sink.put(write, fence(2))
    await expect(sink.put({ segmentId: 'other-segment', segment: makeSegment() }, fence(1, 'other-attempt')))
      .resolves.toBe('STORED')
  })

  it('rejects malformed encoded segments before publication', async () => {
    const sink = new ContractSink()
    const malformed: ArchiveSegmentWrite = {
      segmentId: write.segmentId,
      segment: { ...segment, payloadBase64: 'not-base64' },
    }
    await expect(sink.put(malformed, fence(1))).rejects.toThrow('archive payload is not valid base64')
  })

  it('keeps the complete encoded segment metadata in the identity', async () => {
    const sink = new ContractSink()
    const extended: ArchiveSegmentWrite = {
      segmentId: write.segmentId,
      segment: makeSegment([
        ...defaultEvents,
        { type: 'turn/end', seq: 1, time: 2, data: { turn: 1 } },
      ]),
    }
    await sink.put(write, fence(1))
    await expect(sink.put(extended, fence(1)))
      .rejects.toMatchObject({ code: 'ARCHIVE_IDENTITY_CONFLICT' })
  })
})
