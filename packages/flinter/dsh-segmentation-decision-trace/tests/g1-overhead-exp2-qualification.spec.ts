import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { alternation, analyze, runG1Exp2Smoke, type Exp2PairSample } from './g1-overhead-exp2-qualification.ts'

const samples = (capturesUs: number[], publishMs = 10): Exp2PairSample[] => capturesUs.map((us, pair) => { const offNanoseconds = 20_000_000; const onNanoseconds = offNanoseconds + us * 64 * 1000; return { phase: 'measured' as const, pair, first: alternation(pair).first, offNanoseconds, onNanoseconds, offEvents: 128, onEvents: 128, offAcknowledged: true, onAcknowledged: true, offBytes: 60_000, onBytes: 60_000, offColdPublishMs: publishMs, onColdPublishMs: publishMs, offWarmPublishMs: publishMs, onWarmPublishMs: publishMs, captureUsPerCall: us, pairedRatio: (onNanoseconds - offNanoseconds) / offNanoseconds } })
const repeated = (value: number, count: number): number[] => Array.from({ length: count }, () => value)

describe('G1 overhead experiment 2 analysis', () => {
  it('is deterministic', () => { expect(analyze(samples(repeated(50, 30)))).toEqual(analyze(samples(repeated(50, 30)))) })
  it('classifies capture and durability independently', () => { const pass = analyze(samples(repeated(50, 30))); expect(pass.classification).toBe('PASS'); expect(pass.coldPublish.p50Ms).toBeLessThanOrEqual(25); expect(pass.warmPublish.p50Ms).toBeLessThanOrEqual(25); expect(analyze(samples(repeated(150, 30))).captureClassification).toBe('FAIL'); expect(analyze(samples(repeated(50, 30), 60)).durabilityClassification).toBe('FAIL'); expect(analyze(samples(repeated(50, 30), 60)).classification).toBe('FAIL') })
  it('bounds warm publish separately from cold', () => { const s = samples(repeated(50, 30)); expect(analyze(s.map(sample => ({ ...sample, offWarmPublishMs: 30, onWarmPublishMs: 30 }))).durabilityClassification).toBe('FAIL'); expect(analyze(s.map(sample => ({ ...sample, offColdPublishMs: 60, onColdPublishMs: 60 }))).durabilityClassification).toBe('FAIL'); const pass = analyze(s); expect(pass.coldPublish.p50Ms).toBe(10); expect(pass.warmPublish.p50Ms).toBe(10) })
  it('alternates order', () => { expect(alternation(0)).toEqual({ first: 'off', second: 'on' }); expect(alternation(1)).toEqual({ first: 'on', second: 'off' }) })
  it('rejects tampered capture values and invalid baselines', () => { const s = samples([50])[0]!; expect(() => analyze([{ ...s, captureUsPerCall: 0 }])).toThrow(/inconsistent/); expect(() => analyze([{ ...s, offNanoseconds: 0 }])).toThrow(); expect(() => analyze([], 1, 0)).toThrow(/positive integer/) })
  it('proves a small matched OFF/ON smoke', async () => { const base = join(await mkdtemp(join(tmpdir(), 'g1-exp2-smoke-parent-')), 'fresh'); try { const smoke = await runG1Exp2Smoke(base); expect(smoke.outputEqual).toBe(true); expect(smoke.eventCounts).toEqual({ off: 128, on: 128 }); expect(smoke.bytes.off).toBeGreaterThan(0); expect(smoke.bytes.on).toBeGreaterThan(0); expect(smoke.persistenceAcknowledged).toBe(true); await expect(runG1Exp2Smoke(base)).rejects.toThrow(/must not already exist/) } finally { await rm(join(base, '..'), { recursive: true, force: true }) } })
})
