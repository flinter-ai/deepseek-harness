import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  SessionPersistenceRevision,
  decodeSessionEventArchiveSegmentV1,
  encodeSessionEventArchiveSegmentV1,
  type SessionArchiveSnapshot,
} from '../src/index.ts'
import { ARCHIVE_FIXTURE } from './fixtures/archive-fixture.ts'

const snapshot: SessionArchiveSnapshot = {
  sessionId: SessionId('archive-fixture'),
  sourceRevision: SessionPersistenceRevision('fixture-revision'),
  highWatermarkSeq: 11,
  opaquePrefixToken: 'fixture-token',
}

describe('SessionEventArchiveSegmentV1', () => {
  it('round-trips the approved paginated synthetic fixture losslessly', () => {
    const pages = [ARCHIVE_FIXTURE.slice(0, 4), ARCHIVE_FIXTURE.slice(4, 8), ARCHIVE_FIXTURE.slice(8)]
    const segment = encodeSessionEventArchiveSegmentV1(snapshot, pages.flat())
    const decoded = decodeSessionEventArchiveSegmentV1(segment)

    expect(segment).toMatchObject({
      kind: 'SessionEventArchiveSegmentV1',
      version: 1,
      compression: 'zstd',
      eventCount: 12,
      firstSeq: 0,
      lastSeq: 11,
      highWatermarkSeq: 11,
    })
    expect(segment.payloadSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(segment.decodedEventStreamSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(decoded.events).toEqual(ARCHIVE_FIXTURE)
    expect(decoded.events.find(event => event.type === 'plugin/opaque')).toEqual(ARCHIVE_FIXTURE[8])
  })

  it('canonicalizes object keys before hashing and compression', () => {
    const left = [{ ...ARCHIVE_FIXTURE[0], data: { z: 1, a: { y: 2, x: 3 } } }]
    const right = [{ ...ARCHIVE_FIXTURE[0], data: { a: { x: 3, y: 2 }, z: 1 } }]
    const leftSegment = encodeSessionEventArchiveSegmentV1({ ...snapshot, highWatermarkSeq: 0 }, left)
    const rightSegment = encodeSessionEventArchiveSegmentV1({ ...snapshot, highWatermarkSeq: 0 }, right)
    expect(rightSegment.payloadBase64).toBe(leftSegment.payloadBase64)
    expect(rightSegment.decodedEventStreamSha256).toBe(leftSegment.decodedEventStreamSha256)
  })

  it('fails closed when the compressed payload is modified', () => {
    const segment = encodeSessionEventArchiveSegmentV1(snapshot, ARCHIVE_FIXTURE)
    const changedPayload = Buffer.from(segment.payloadBase64, 'base64')
    changedPayload[changedPayload.length - 1] = (changedPayload.at(-1) as number) ^ 0x01
    expect(() => decodeSessionEventArchiveSegmentV1({
      ...segment,
      payloadBase64: changedPayload.toString('base64'),
    })).toThrow('payload SHA-256 mismatch')
  })
})
