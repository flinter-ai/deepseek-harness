/** Keyless tests for the bounded evidence-memory seam. */

import { describe, expect, it } from 'vitest'
import {
  REASONING_BANK_MAX_EVENT_IDS,
  REASONING_BANK_MAX_SUMMARY_LENGTH,
  REASONING_BANK_SCHEMA_VERSION,
  createReasoningBank,
  reasoningEntryFor,
} from '../reasoning-bank.js'
import {
  DEFAULT_PRODUCER_SHA,
  searchableTraceIdFor,
  traceRecordFor,
  type TraceRecord,
} from '../trace-record.js'
import { RESULT_SCHEMA_VERSION, type PesResult } from '../query.js'

const CONTEXT = {
  organizationId: 'org-bank',
  projectId: 'project-bank',
  episodeId: 'episode-bank',
  jobId: 'job-bank',
  irId: 'ir-bank',
  jobOutputId: 'output-bank',
  artifactId: 'artifact-bank',
}

function result(overrides: Partial<PesResult> = {}): PesResult {
  return {
    tool: 'search_events',
    schema_version: RESULT_SCHEMA_VERSION,
    status: 'completed',
    mode: 'search',
    count: 2,
    bounded: true,
    event_ids: ['event-a', 'event-a', 'event-b'],
    events: [{ secret: 'must not enter the bank' }],
    abstained: false,
    artifact_verification: 'verified',
    provenance: {
      plugin: '@flinter/dsh-pes',
      engine: 'event_index.query',
      engine_protocol: 'event_index.query stdin-jsonl v1',
    },
    query: 'cup acquisition',
    n: 3,
    ...overrides,
  }
}

function record(runOrdinal = 0): TraceRecord {
  return traceRecordFor({
    context: { ...CONTEXT, runOrdinal },
    result: result(),
  })
}

describe('dsh-pes reasoning bank entry', () => {
  it('is deterministic, evidence-linked, and excludes the full event payload', () => {
    const first = reasoningEntryFor(record(), result())
    const second = reasoningEntryFor(record(), result())
    expect(first).toEqual(second)
    expect(first.schemaVersion).toBe(REASONING_BANK_SCHEMA_VERSION)
    expect(first.id).toMatch(/^rb_[0-9a-f]{24}$/)
    expect(first.traceId).toBe(searchableTraceIdFor({ ...CONTEXT, runOrdinal: 0 }))
    expect(first.producerSha).toBe(DEFAULT_PRODUCER_SHA)
    expect(first.evidenceIds).toEqual(['event-a', 'event-b'])
    expect(first.eventCount).toBe(3)
    expect(first.cue).toContain('cup acquisition')
    expect(first.lesson).toContain('verified')
    expect(first).not.toHaveProperty('events')
    expect(JSON.stringify(first)).not.toContain('must not enter the bank')
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.evidenceIds)).toBe(true)
  })

  it('bounds summaries and event links and rejects abstained results', () => {
    const longRecord = { ...record(), summaryText: 'x'.repeat(2_000) }
    const manyIds = Array.from({ length: REASONING_BANK_MAX_EVENT_IDS + 8 }, (_, i) => `event-${i}`)
    const entry = reasoningEntryFor(longRecord, result({ event_ids: manyIds }))
    expect(entry.summary).toHaveLength(REASONING_BANK_MAX_SUMMARY_LENGTH)
    expect(entry.evidenceIds).toHaveLength(REASONING_BANK_MAX_EVENT_IDS)
    expect(() => reasoningEntryFor(record(), result({ status: 'abstained', abstained: true })))
      .toThrow(/completed, non-abstained/)
  })
})

describe('dsh-pes reasoning bank store', () => {
  it('deduplicates by trace id, evicts oldest entries, and searches deterministically', () => {
    const bank = createReasoningBank({ maxEntries: 2 })
    const first = bank.ingest(record(0), result())
    expect(bank.ingest(record(0), result())).toEqual(first)
    bank.ingest(record(1), result({ query: 'plate placement' }))
    bank.ingest(record(2), result({ query: 'drawer opening' }))

    expect(bank.size()).toBe(2)
    expect(bank.list().map(entry => entry.runOrdinal)).toEqual([1, 2])
    expect(bank.search('plate')).toHaveLength(1)
    expect(bank.search('drawer', 1).map(entry => entry.runOrdinal)).toEqual([2])
    expect(bank.search('', 1)).toHaveLength(1)
  })

  it('fails loud for malformed caps', () => {
    expect(() => createReasoningBank({ maxEntries: 0 })).toThrow(/maxEntries/)
    expect(() => createReasoningBank({ maxEntries: 1.5 })).toThrow(/maxEntries/)
    expect(() => createReasoningBank(null as never)).toThrow(/options/)
  })
})
