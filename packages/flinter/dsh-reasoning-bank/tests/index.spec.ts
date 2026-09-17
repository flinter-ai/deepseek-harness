import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as reasoningBank from '../src/index.ts'
import {
  Config,
  REASONING_BANK_MAX_EVIDENCE_ID_LENGTH,
  REASONING_BANK_SERVICE,
  apply,
  createReasoningBank,
  inject,
  name,
  type ReasoningBank,
} from '../src/index.ts'

const meta = (id: string, summary = `summary ${id}`) => ({ id, traceKind: 'search_events', producerSha: 'abc', runOrdinal: 1, summaryText: summary })
const result = (evidenceIds: string[] = ['event-1']) => ({ status: 'completed' as const, abstained: false as const, evidenceIds })

describe('reasoning bank', () => {
  it('keeps the named function-plugin namespace through Loader unwrapExports', () => {
    expect('default' in reasoningBank).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(reasoningBank) as Record<string, unknown>
    expect(unwrapped).toBe(reasoningBank)
    expect(unwrapped).toMatchObject({ name, inject, Config, apply })
  })

  it('deduplicates by trace and evicts oldest entries FIFO', () => {
    const bank = createReasoningBank({ maxEntries: 2 })
    bank.ingest(meta('a'), result()); bank.ingest(meta('b'), result()); bank.ingest(meta('a', 'replacement'), result())
    expect(bank.size()).toBe(2); expect(bank.list().map(x => x.traceId)).toEqual(['a', 'b'])
    bank.ingest(meta('c'), result()); expect(bank.list().map(x => x.traceId)).toEqual(['b', 'c'])
  })
  it('bounds fields, evidence IDs, and search results', () => {
    const bank = createReasoningBank({ maxEntries: 1 })
    bank.ingest(meta('long', 'x'.repeat(700)), result(Array.from({ length: 60 }, (_, i) => `id-${i}`)))
    const entry = bank.list()[0]!; expect(entry.summary.length).toBeLessThanOrEqual(512); expect(entry.evidenceIds).toHaveLength(32)
    expect(entry.evidenceIds[0]).toHaveLength(4)
    expect(bank.search('id-31', 100)).toHaveLength(1); expect(bank.search('missing')).toHaveLength(0)
    bank.ingest(meta('bounded-id'), result(['x'.repeat(REASONING_BANK_MAX_EVIDENCE_ID_LENGTH + 20)]))
    expect(bank.list()[0]?.evidenceIds[0]).toHaveLength(REASONING_BANK_MAX_EVIDENCE_ID_LENGTH)
  })
  it('rejects invalid inputs and supports plugin enable/disable', async () => {
    expect(() => createReasoningBank({ maxEntries: 0 })).toThrow(/maxEntries/u)
    const bank = createReasoningBank()
    expect(() => bank.ingest(meta('bad'), { status: 'completed', abstained: false, evidenceIds: [{ payload: 'secret' }] as never })).toThrow(/evidenceIds\[0\]/u)
    const disabled = new Context()
    apply(disabled, { enabled: false })
    expect(disabled.get(REASONING_BANK_SERVICE, false)).toBeUndefined()
    const enabled = new Context()
    const fiber = await enabled.plugin({ name, inject, Config, apply }, { maxEntries: 1 })
    const service = enabled.get(REASONING_BANK_SERVICE) as ReasoningBank | undefined
    expect(service?.size()).toBe(0)
    await fiber.dispose()
    expect(enabled.get(REASONING_BANK_SERVICE, false)).toBeUndefined()
  })
})
