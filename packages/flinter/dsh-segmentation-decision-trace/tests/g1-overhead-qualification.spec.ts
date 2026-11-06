import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { alternation, analyze, qualificationCallId, runG1Smoke } from './g1-overhead-qualification.ts'
const samples = (values: number[]) => values.map((v, pair) => ({ phase: 'measured' as const, pair, first: alternation(pair).first, offNanoseconds: 100, onNanoseconds: 100 * (1 + v), offEvents: 0, onEvents: 128, offAcknowledged: true, onAcknowledged: true, pairedRatio: v }))
const repeated = (value: number, count: number): number[] => Array.from({ length: count }, () => value)
describe('G1 overhead analysis', () => {
  it('is deterministic', () => { expect(analyze(samples(repeated(0.01, 30)))).toEqual(analyze(samples(repeated(0.01, 30)))) })
  it('classifies pass, inconclusive, and fail', () => { const zeros = Array.from({ length: 29 }, () => 0); expect(analyze(samples(Array.from({ length: 30 }, () => 0.01))).classification).toBe('PASS'); expect(analyze(samples([...zeros, 1])).classification).toBe('INCONCLUSIVE'); expect(analyze(samples(Array.from({ length: 30 }, () => 0.2))).classification).toBe('FAIL') })
  it('alternates order', () => { expect(alternation(0)).toEqual({ first: 'off', second: 'on' }); expect(alternation(1)).toEqual({ first: 'on', second: 'off' }) })
  it('uses matched call identities for both arms', () => { expect(Array.from({ length: 3 }, (_, call) => qualificationCallId(2, call))).toEqual(['call-2-0', 'call-2-1', 'call-2-2']) })
  it('rejects invalid baselines', () => { const invalid = { phase: 'measured' as const, pair: 0, first: 'off' as const, offEvents: 0, onEvents: 128, offAcknowledged: true, onAcknowledged: true, pairedRatio: 0 }; expect(() => analyze([{ ...invalid, offNanoseconds: 0, onNanoseconds: 1 }])).toThrow(); expect(() => analyze([{ ...invalid, offNanoseconds: NaN, onNanoseconds: 1 }])).toThrow() })
  it('rejects tampered ratios and invalid resample counts', () => { expect(() => analyze([{ ...samples([0.1])[0]!, pairedRatio: 0 }])).toThrow(/inconsistent/); expect(() => analyze(samples([0.01]), 1, 0)).toThrow(/positive integer/) })
  it('proves a small real OFF/ON smoke', async () => { const base = join(await mkdtemp(join(tmpdir(), 'g1-overhead-smoke-parent-')), 'fresh'); try { await expect(runG1Smoke(base)).resolves.toEqual({ outputEqual: true, eventCounts: { off: 0, on: 128 }, persistenceAcknowledged: true }); await expect(runG1Smoke(base)).rejects.toThrow(/must not already exist/) } finally { await rm(join(base, '..'), { recursive: true, force: true }) } })
})
