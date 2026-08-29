import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  InMemoryImmutableSegmentStore,
  LocalTraceCheckpointSink,
  type TraceCheckpointInput,
} from '../src/index.ts'

function event(type: string, seq: number, data: Record<string, unknown> = {}): SessionEvent {
  return { type, seq, time: seq + 1, data } as SessionEvent
}

function input(events: readonly SessionEvent[], overrides: Partial<TraceCheckpointInput> = {}): TraceCheckpointInput {
  return {
    organizationId: 'org-test',
    tenantId: 'tenant-test',
    episodeId: 'episode-test',
    runId: 'run-test',
    sessionId: 'session-test',
    events,
    metadata: {
      provider: 'modelflare',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'low',
      tokenUsage: { input: 10, output: 4 },
      terminalStatus: 'completed',
    },
    ...overrides,
  }
}

describe('@flinter/dsh-trace-link checkpoint contract', () => {
  it('produces deterministic immutable descriptors and manifests', async () => {
    const events = [
      event('session', 0, { z: 2, a: 1 }),
      event('turn/start', 1, { turn: 'one' }),
    ]
    const first = await new LocalTraceCheckpointSink().checkpoint(input(events))
    const second = await new LocalTraceCheckpointSink().checkpoint(input([
      event('session', 0, { a: 1, z: 2 }),
      event('turn/start', 1, { turn: 'one' }),
    ]))

    expect(first).toEqual(second)
    expect(Object.isFrozen(first.descriptor)).toBe(true)
    expect(Object.isFrozen(first.manifest)).toBe(true)
    expect(Object.isFrozen(first.manifest.segments)).toBe(true)
    expect(first.descriptor.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(first.manifest.manifestId).toBe(`manifest:${first.manifest.manifestHash}`)
  })

  it('appends contiguous ranges to an immutable local segment store', async () => {
    const store = new InMemoryImmutableSegmentStore()
    const sink = new LocalTraceCheckpointSink(store)
    const first = await sink.checkpoint(input([event('session', 0), event('turn/start', 1)]))
    const second = await sink.checkpoint(input([event('request/header', 2), event('turn/end', 3)]))

    expect(first.descriptor.seqStart).toBe(0)
    expect(first.descriptor.seqEnd).toBe(1)
    expect(second.descriptor.seqStart).toBe(2)
    expect(second.descriptor.seqEnd).toBe(3)
    expect(second.manifest.firstSeq).toBe(0)
    expect(second.manifest.lastSeq).toBe(3)
    expect(second.manifest.segmentCount).toBe(2)
    expect(second.descriptor.storageRef).toBe(`memory://trace-segment/${second.descriptor.contentHash}`)
    await expect(store.get(second.descriptor.storageRef)).resolves.toMatchObject({
      contentHash: second.descriptor.contentHash,
    })
  })

  it('makes exact retries idempotent and rejects conflicting or overlapping ranges', async () => {
    const sink = new LocalTraceCheckpointSink()
    const firstInput = input([event('session', 0), event('turn/start', 1)])
    const first = await sink.checkpoint(firstInput)
    await sink.checkpoint(input([event('request/header', 2)]))
    const retry = await sink.checkpoint(firstInput)
    expect(retry.descriptor).toEqual(first.descriptor)
    expect(retry.manifest.segmentCount).toBe(2)
    await expect(sink.checkpoint(input([event('session', 0), event('turn/start', 1, { changed: true })])))
      .rejects.toThrow(/different content/)
    await expect(sink.checkpoint(input([event('turn/start', 1), event('request/header', 2)])))
      .rejects.toThrow(/overlap/)
  })

  it('fails closed for invalid sequence ranges and identity changes', async () => {
    const sink = new LocalTraceCheckpointSink()
    await expect(sink.checkpoint(input([event('session', 1)]))).rejects.toThrow(/start at sequence 0/)
    await expect(sink.checkpoint(input([event('session', 0), event('turn/start', 2)])))
      .rejects.toThrow(/contiguous/)

    await sink.checkpoint(input([event('session', 0)]))
    await expect(sink.checkpoint(input([event('turn/start', 1)], { tenantId: 'other-tenant' })))
      .rejects.toThrow(/identity/)
  })

  it('redacts credential values while preserving environment references and nulls', async () => {
    const store = new InMemoryImmutableSegmentStore()
    const sink = new LocalTraceCheckpointSink(store)
    const receipt = await sink.checkpoint(input([event('session', 0, {
      credentials: { apiKey: 'must-not-be-stored', apiKeyEnv: 'MODELFLARE_API_KEY' },
      result: null,
      provenance: 'local-mock',
      abstention: 'UNKNOWN',
    })]))
    const stored = await store.get(receipt.descriptor.storageRef)

    expect(stored?.bytes).not.toContain('must-not-be-stored')
    expect(stored?.bytes).toContain('MODELFLARE_API_KEY')
    expect(stored?.bytes).toContain('UNKNOWN')
    expect(stored?.bytes).toContain('null')
    expect(receipt.descriptor.redactionApplied).toBe(true)
  })

  it('rejects non-lossless event data instead of serializing it implicitly', async () => {
    const invalid = event('session', 0, { invalid: undefined })
    await expect(new LocalTraceCheckpointSink().checkpoint(input([invalid])))
      .rejects.toThrow(/JSON-serializable/)
  })
})
