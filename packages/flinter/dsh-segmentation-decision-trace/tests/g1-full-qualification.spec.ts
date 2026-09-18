import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseTestData, runG1Full } from './g1-full-qualification.ts'

/* oxlint-disable @stylistic/max-len */

type EventRecord = { type: string; data: { projection: Record<string, unknown> } }

const inputPath = '/Users/oldap/flinter/.worktrees/search-r1-g1-local-qualification-20260918/docs/physical-experience-search/delivery-gates/g1-coordinator-runtime-input.v1.json'
const load = async () => parseTestData(JSON.parse(await readFile(inputPath, 'utf8')))

describe('G1 full qualification', () => {
  it('parses the settled corpus exactly', async () => {
    const input = await load()
    expect(input).toMatchObject({ sessionId: 'g1-full-corpus', toolName: 'segment.qualify', scope: 'local-runtime-fixture', timeoutMs: 25 })
    expect(input.cases.map(c => c.call_id)).toEqual([...Array.from({ length: 11 }, (_, i) => `call-${String(i + 1).padStart(2, '0')}`), 'call-13'])
    expect(input.cases.map(c => c.stimulus.kind)).toEqual(['return', 'return', 'return', 'return', 'throw', 'throw', 'timeout', 'return', 'return', 'return', 'cancel', 'return'])
    expect(input.cases.at(10)!.request.budgetBefore).toBe(7)
    expect(input.cases.at(11)!.request.budgetBefore).toBeNull()
  })

  it('runs, reloads, and emits canonical projections', async () => {
    const input = await load(); const base = await mkdtemp(join(tmpdir(), 'g1-full-local-')); const outputPath = join(base, 'out.json'); const root = join(base, 'persist')
    try {
      const out = await runG1Full({ input, inputPath, outputPath, persistenceRoot: root })
      expect(out.persistenceAck).toBe(true); expect(out.events).toHaveLength(24); expect(out.toolResults).toHaveLength(12); expect(out.reloadEquality.equal).toBe(true); expect(out.reloadEquality.liveDigest).toBe(out.reloadEquality.reloadedDigest)
      expect(out.provenance.harness).toBe('dsh-segmentation-decision-trace/tests/g1-full-qualification.ts')
      expect(out.provenance.inputSha256).toBe('bbe385a9a89f2c9b4a749ddc8b00b71855cf8a66c1d4aa724e77f9836c19d6be')
      expect(out.toolResults.filter(r => r.isError)).toHaveLength(4)
      expect(out.toolResults.filter(r => !r.isError)).toHaveLength(8)
      expect(out.toolResults.map(r => r.errorCode)).toEqual([undefined, undefined, undefined, undefined, 'FIXTURE_MALFORMED_RESPONSE', 'FIXTURE_PROVIDER_ERROR', 'TOOL_TIMEOUT', undefined, undefined, undefined, 'ABORTED', undefined])
      expect(out.toolResults.filter(r => r.isError).map(r => [r.errorCode, r.errorName])).toEqual([['FIXTURE_MALFORMED_RESPONSE', 'FixtureStimulusError'], ['FIXTURE_PROVIDER_ERROR', 'FixtureStimulusError'], ['TOOL_TIMEOUT', 'ToolTimeoutError'], ['ABORTED', 'AbortError']])
      expect(out.toolResults.every(r => r.sessionId === input.sessionId && r.toolName === input.toolName && typeof r.decisionId === 'string' && r.entered === true)).toBe(true)
      const events = out.events as EventRecord[]
      expect(events.map(e => e.type)).toEqual(Array.from({ length: 12 }, () => ['flinter/decision-selection', 'flinter/decision-result']).flat())
      expect(events.filter(e => e.type === 'flinter/decision-result').map(e => e.data.projection)).toEqual([
        { outcome: 'success', disposition: 'retained', usage: 3, resultRefs: ['result:g1-01'], evidenceRefs: [], lineageStatus: 'unknown', recordingReady: false, indexReady: false },
        { outcome: 'rejection', disposition: 'discarded', usage: null, resultRefs: [], evidenceRefs: [], lineageStatus: 'unknown', recordingReady: false, indexReady: false },
        { outcome: 'abstention', disposition: 'abstained', usage: 0, resultRefs: [], evidenceRefs: [], lineageStatus: 'unknown', recordingReady: false, indexReady: false },
        { outcome: 'unavailable-evidence', disposition: 'unavailable', usage: null, resultRefs: [], evidenceRefs: [], lineageStatus: 'unknown', recordingReady: false, indexReady: false },
        { outcome: 'malformed-response', disposition: 'discarded', usage: null, resultRefs: [], evidenceRefs: [], lineageStatus: 'unknown', recordingReady: false, indexReady: false },
        { outcome: 'provider-error', disposition: 'unknown', usage: null, resultRefs: [], evidenceRefs: [], lineageStatus: 'unknown', recordingReady: false, indexReady: false },
        { outcome: 'timeout', disposition: 'unknown', usage: null, resultRefs: [], evidenceRefs: [], lineageStatus: 'unknown', recordingReady: false, indexReady: false },
        { outcome: 'exhaustion', disposition: 'abstained', usage: 7, resultRefs: [], evidenceRefs: [], lineageStatus: 'unknown', recordingReady: false, indexReady: false },
        { outcome: 'partial-retention', disposition: 'partial', usage: null, resultRefs: ['result:g1-09-child-a'], evidenceRefs: [], lineageStatus: 'unknown', recordingReady: false, indexReady: false },
        { outcome: 'export-conflict', disposition: 'partial', usage: null, resultRefs: ['result:g1-10-conflict-a', 'result:g1-10-conflict-b'], evidenceRefs: [], lineageStatus: 'unknown', recordingReady: false, indexReady: false },
        { outcome: 'cancelled', disposition: 'unknown', usage: null, resultRefs: [], evidenceRefs: [], lineageStatus: 'unknown', recordingReady: false, indexReady: false },
        { outcome: 'unknown', disposition: 'unknown', usage: null, resultRefs: [], evidenceRefs: [], lineageStatus: 'unknown', recordingReady: false, indexReady: false },
      ])
      expect(out.diagnostics).toEqual([])
      const values = out.toolResults.flatMap(r => r.value ? [r.value as Record<string, unknown>] : []); expect(values.some(v => v.kind)).toBe(false); expect(values.reduce((n, v) => n + (typeof v.usage === 'number' ? v.usage : 0), 0)).toBe(10); expect(events.filter(e => e.type === 'flinter/decision-result').filter(e => e.data.projection.usage === null)).toHaveLength(9)
    } finally { await rm(base, { recursive: true, force: true }) }
  })

  it('rejects existing roots and strict boundaries', async () => {
    const input = await load(); const base = await mkdtemp(join(tmpdir(), 'g1-full-boundary-'))
    try { await expect(runG1Full({ input, persistenceRoot: base })).rejects.toThrow(/must not already exist/)
      const duplicate = JSON.parse(await readFile(inputPath, 'utf8')); duplicate.cases[1].call_id = duplicate.cases[0].call_id; expect(() => parseTestData({ ...duplicate, schema: 'wrong' })).toThrow(/schema/); expect(() => parseTestData(duplicate)).toThrow(/invalid case/)
    } finally { await rm(base, { recursive: true, force: true }) }
  })

  it('keeps the harness independent of the coordinator ledger', async () => {
    const source = await readFile(new URL('./g1-full-qualification.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('runtime-ledger'); expect(source).not.toContain('g1-coordinator-runtime-input.v1.json')
  })
})
