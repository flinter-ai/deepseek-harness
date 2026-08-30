import { createHash } from 'node:crypto'
import { zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  MAX_SESSION_EVENT_ARCHIVE_PAYLOAD_BYTES,
  SessionPersistenceRevision,
  decodeSessionEventArchiveSegmentV1,
  encodeSessionEventArchiveSegmentV1,
  type SessionArchiveEvent,
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
    const left = [{ ...ARCHIVE_FIXTURE[0]!, data: { z: 1, a: { y: 2, x: 3 } } }]
    const right = [{ ...ARCHIVE_FIXTURE[0]!, data: { a: { x: 3, y: 2 }, z: 1 } }]
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

  it('rejects an empty prefix with a non-empty high-water mark', () => {
    expect(() => encodeSessionEventArchiveSegmentV1(
      { ...snapshot, highWatermarkSeq: 0 },
      [],
    )).toThrow('expected highWatermarkSeq 0')
  })

  it('round-trips an empty prefix', () => {
    const segment = encodeSessionEventArchiveSegmentV1({ ...snapshot, highWatermarkSeq: -1 }, [])
    const decoded = decodeSessionEventArchiveSegmentV1(segment)
    expect(segment).toMatchObject({ eventCount: 0, firstSeq: -1, lastSeq: -1, highWatermarkSeq: -1 })
    expect(decoded.events).toEqual([])
  })

  it('rejects malformed metadata before decoding payload bytes', () => {
    const segment = encodeSessionEventArchiveSegmentV1(snapshot, ARCHIVE_FIXTURE)
    expect(() => decodeSessionEventArchiveSegmentV1({ ...segment, version: 2 as 1 }))
      .toThrow('invalid SessionEventArchiveSegmentV1 metadata')
  })

  it('rejects a payload whose decoded stream checksum is wrong', () => {
    const segment = encodeSessionEventArchiveSegmentV1(snapshot, ARCHIVE_FIXTURE)
    expect(() => decodeSessionEventArchiveSegmentV1({
      ...segment,
      decodedEventStreamSha256: '0'.repeat(64),
    })).toThrow('decoded event-stream SHA-256 mismatch')
  })

  it('rejects a decoded stream without its final newline', () => {
    const event = ARCHIVE_FIXTURE[0]!
    const decodedBytes = Buffer.from(JSON.stringify(event), 'utf8')
    const payload = zstdCompressSync(decodedBytes)
    const segment = encodeSessionEventArchiveSegmentV1({ ...snapshot, highWatermarkSeq: 0 }, [event])
    expect(() => decodeSessionEventArchiveSegmentV1({
      ...segment,
      payloadBase64: payload.toString('base64'),
      payloadSha256: sha256(payload),
      decodedEventStreamSha256: sha256(decodedBytes),
    })).toThrow('missing its final newline')
  })

  it('rejects a compressed payload over the local capacity limit', () => {
    const segment = encodeSessionEventArchiveSegmentV1(snapshot, ARCHIVE_FIXTURE)
    const oversizedPayload = Buffer.alloc(MAX_SESSION_EVENT_ARCHIVE_PAYLOAD_BYTES + 1)
    expect(() => decodeSessionEventArchiveSegmentV1({
      ...segment,
      payloadBase64: oversizedPayload.toString('base64'),
    })).toThrow(`archive payload exceeds ${MAX_SESSION_EVENT_ARCHIVE_PAYLOAD_BYTES} bytes`)
  })

  it.each([
    ['gap', [{ ...ARCHIVE_FIXTURE[0]!, seq: 1 }]],
    ['overlap', [{ ...ARCHIVE_FIXTURE[0]!, seq: 0 }, { ...ARCHIVE_FIXTURE[1]!, seq: 0 }]],
  ])('rejects a %s in the canonical sequence', (_label, events) => {
    expect(() => encodeSessionEventArchiveSegmentV1(
      { ...snapshot, highWatermarkSeq: events.length - 1 },
      events as readonly SessionArchiveEvent[],
    )).toThrow('invalid envelope')
  })

  it('rejects invalid event envelopes and invalid high-water marks', () => {
    expect(() => encodeSessionEventArchiveSegmentV1(
      { ...snapshot, highWatermarkSeq: 0 },
      [null as unknown as SessionArchiveEvent],
    )).toThrow('is not an object')
    expect(() => encodeSessionEventArchiveSegmentV1(
      { ...snapshot, highWatermarkSeq: 0 },
      [{ ...ARCHIVE_FIXTURE[0]!, type: '' }],
    )).toThrow('invalid envelope')
    expect(() => encodeSessionEventArchiveSegmentV1(
      { ...snapshot, highWatermarkSeq: Number.NaN },
      [],
    )).toThrow('highWatermarkSeq')
  })

  it('rejects a decoded stream with invalid JSON or a non-object event', () => {
    const base = encodeSessionEventArchiveSegmentV1({ ...snapshot, highWatermarkSeq: 0 }, [ARCHIVE_FIXTURE[0]!])
    for (const text of ['not-json\n', '[]\n']) {
      const decodedBytes = Buffer.from(text, 'utf8')
      const payload = zstdCompressSync(decodedBytes)
      expect(() => decodeSessionEventArchiveSegmentV1({
        ...base,
        payloadBase64: payload.toString('base64'),
        payloadSha256: sha256(payload),
        decodedEventStreamSha256: sha256(decodedBytes),
      })).toThrow()
    }
  })

  it('rejects payload metadata that disagrees with decoded events', () => {
    const segment = encodeSessionEventArchiveSegmentV1(snapshot, ARCHIVE_FIXTURE)
    expect(() => decodeSessionEventArchiveSegmentV1({ ...segment, eventCount: 1 }))
      .toThrow('event metadata does not match')
  })
})

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
