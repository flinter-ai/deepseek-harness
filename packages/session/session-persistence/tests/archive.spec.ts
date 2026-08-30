import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  archivePrefixHash,
  decodeArchiveToken,
  encodeArchiveToken,
  snapshotArchiveEvents,
  type SessionArchiveEvent,
  type SessionArchiveSnapshot,
} from '../src/archive.ts'
import { SessionPersistenceRevision } from '../src/revision.ts'

const id = SessionId('archive-contract')
const revision = SessionPersistenceRevision('revision-1')

function event(overrides: Partial<SessionArchiveEvent> = {}): SessionArchiveEvent {
  return {
    type: 'plugin/opaque',
    seq: 0,
    time: 1,
    data: { z: 1, a: null },
    pluginField: { retained: true },
    ...overrides,
  }
}

function snapshot(overrides: Partial<SessionArchiveSnapshot> = {}): SessionArchiveSnapshot {
  const prefix = [event()]
  return {
    sessionId: id,
    sourceRevision: revision,
    highWatermarkSeq: 0,
    opaquePrefixToken: encodeArchiveToken(id, revision, 0, archivePrefixHash(prefix)),
    ...overrides,
  }
}

describe('archive event validation and identity', () => {
  it('detaches unknown events without changing their logical shape', () => {
    const original = event()
    const detached = snapshotArchiveEvents([original], id)
    expect(detached).toEqual([original])
    expect(detached[0]).not.toBe(original)
    expect(detached[0]!.data).not.toBe(original.data)
  })

  it.each([
    ['non-object', null as unknown as SessionArchiveEvent, 'non-object'],
    ['empty type', event({ type: '' }), 'invalid type'],
    ['wrong sequence', event({ seq: 1 }), 'non-contiguous'],
    ['unsafe time', event({ time: Number.POSITIVE_INFINITY }), 'invalid time'],
  ])('rejects an archive event with %s', (_label, candidate, message) => {
    expect(() => snapshotArchiveEvents([candidate as unknown as SessionEvent], id)).toThrow(message)
  })

  it('hashes canonical object-key order and rejects non-JSON values', () => {
    const left = event({ data: { z: 1, a: { y: 2, x: 3 } } })
    const right = event({ data: { a: { x: 3, y: 2 }, z: 1 } })
    expect(archivePrefixHash([left])).toBe(archivePrefixHash([right]))
    expect(archivePrefixHash([event({ data: null })])).toMatch(/^[a-f0-9]{64}$/)
    expect(() => archivePrefixHash([event({ data: Number.POSITIVE_INFINITY })]))
      .toThrow('non-finite number')
    expect(() => archivePrefixHash([event({ extra: undefined })]))
      .toThrow('non-JSON value')
  })
})

describe('archive checkpoint token validation', () => {
  it('round-trips a serialized checkpoint token', () => {
    const checkpoint = snapshot()
    expect(decodeArchiveToken(checkpoint)).toMatchObject({
      version: 1,
      sessionId: id,
      sourceRevision: revision,
      highWatermarkSeq: 0,
    })
  })

  it.each([
    ['invalid encoding', 'not-a-token', snapshot()],
    ['non-record JSON', Buffer.from('null').toString('base64url'), snapshot()],
    ['array JSON', Buffer.from('[]').toString('base64url'), snapshot()],
    ['wrong version', token({ version: 2 }), snapshot()],
    ['wrong session', token({ sessionId: 'other' }), snapshot()],
    ['wrong revision', token({ sourceRevision: 'other' }), snapshot()],
    ['wrong high-water mark', token({ highWatermarkSeq: 2 }), snapshot()],
    ['unsafe high-water mark', token({ highWatermarkSeq: 0.5 }), snapshot({ highWatermarkSeq: 0.5 })],
    ['negative high-water mark', token({ highWatermarkSeq: -2 }), snapshot({ highWatermarkSeq: -2 })],
    ['missing hash', token({ prefixHash: undefined }), snapshot()],
    ['malformed hash', token({ prefixHash: 'bad' }), snapshot()],
  ])('rejects %s', (_label, opaquePrefixToken, checkpoint) => {
    expect(() => decodeArchiveToken({ ...checkpoint, opaquePrefixToken }))
      .toThrow('STALE_SNAPSHOT')
  })
})

function token(overrides: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify({
    version: 1,
    sessionId: id,
    sourceRevision: revision,
    highWatermarkSeq: 0,
    prefixHash: '0'.repeat(64),
    ...overrides,
  }), 'utf8').toString('base64url')
}
