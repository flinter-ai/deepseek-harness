/* oxlint-disable @stylistic/max-len */
import { Context } from '@deepseek-ai/cordis'
import * as decisionTrace from '@deepseek-ai/dsh-decision-trace'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { createHash } from 'node:crypto'
import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import * as segmentationTrace from '../src/index.ts'

export const WARMUP_PAIRS = 5
export const MEASURED_PAIRS = 30
export const CALLS_PER_ARM = 64
export const CANDIDATE_COUNT = 24
export const BOOTSTRAP_RESAMPLES = 10_000
export const SEED = 20260918
export const THRESHOLD = 0.05
type Arm = 'off' | 'on'
export interface PairSample { phase: 'warmup' | 'measured'; pair: number; first: Arm; offNanoseconds: number; onNanoseconds: number; offEvents: number; onEvents: number; offAcknowledged: boolean; onAcknowledged: boolean; pairedRatio: number }
export interface Analysis { estimate: number; interval: { lower: number; upper: number }; classification: 'PASS' | 'INCONCLUSIVE' | 'FAIL' }
const finitePositive = (n: number) => Number.isFinite(n) && n > 0
const ratio = (off: number, on: number) => { if (!finitePositive(off) || !finitePositive(on)) throw new TypeError('timings must be finite and positive'); return (on - off) / off }
function rng(seed: number) { let x = seed >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 0x1_0000_0000 } }
export function analyze(samples: readonly PairSample[], seed = SEED, resamples = BOOTSTRAP_RESAMPLES): Analysis {
  if (!samples.length || !Number.isInteger(resamples) || resamples <= 0) throw new TypeError('samples must not be empty and resamples must be a positive integer')
  const values = samples.map((sample) => { const computed = ratio(sample.offNanoseconds, sample.onNanoseconds); if (sample.pairedRatio !== computed) throw new TypeError('pairedRatio is inconsistent with timings'); return computed })
  const estimate = values.reduce((sum, value) => sum + value, 0) / values.length; const random = rng(seed); const boots = new Array<number>(resamples)
  for (let b = 0; b < resamples; b++) { let sum = 0; for (const _ of values) sum += values[Math.floor(random() * values.length)]!; boots[b] = sum / values.length }
  boots.sort((a, b) => a - b); const lower = boots[Math.floor(resamples * 0.025)]!; const upper = boots[Math.min(resamples - 1, Math.floor(resamples * 0.975))]!
  return { estimate, interval: { lower, upper }, classification: lower > THRESHOLD ? 'FAIL' : upper <= THRESHOLD ? 'PASS' : 'INCONCLUSIVE' }
}
export function alternation(pair: number): { first: Arm; second: Arm } { return pair % 2 === 0 ? { first: 'off', second: 'on' } : { first: 'on', second: 'off' } }
export function qualificationCallId(pair: number, call: number): string { return `call-${pair}-${call}` }
function workload(): { output: string; digest: string } { const scored = Array.from({ length: CANDIDATE_COUNT }, (_, i) => ({ id: `candidate-${i}`, score: (i * 17 + 11) % 29 })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)); const output = JSON.stringify(scored.slice(0, 8)); return { output, digest: createHash('sha256').update(output).digest('hex') } }
async function arm(root: string, enabled: boolean, pair: number): Promise<{ ns: number; outputs: string[]; digest: string; events: number; acknowledged: boolean }> {
  const ctx = new Context(); await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none', packChunks: false }); await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  ctx.tools.register(defineTool({ name: 'segment.qualify', description: 'deterministic scoring fixture', parameters: {}, output: { schema: { type: 'object', additionalProperties: false, properties: { output: { type: 'string', required: true }, digest: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, async execute() { return workload() } }))
  if (enabled) await ctx.plugin(decisionTrace); if (enabled) await ctx.plugin(segmentationTrace, { toolName: 'segment.qualify', source: { request: () => ({ allowedActions: ['segment'], chosenAction: 'segment', requestedEvidenceRefs: [], fetchedEvidenceRefs: [], displayedEvidenceRefs: [], budgetBefore: 1, candidateRefs: ['fixture'], lineageRefs: [], sourceRef: 'g1', modelRef: 'deterministic', policyRevisionRef: 'g1' }), result: () => ({ outcome: 'success', disposition: 'retained' }) } })
  const session = ctx.sessions.create(SessionId(`g1-overhead-${enabled ? 'on' : 'off'}-${pair}`), { meta: { cwd: process.cwd() } }); const start = process.hrtime.bigint(); const outputs: string[] = []
  for (let call = 0; call < CALLS_PER_ARM; call++) { const result = await ctx.tools.execute({ signal: new AbortController().signal, callId: qualificationCallId(pair, call), name: 'segment.qualify', arguments: {}, agent: { id: session.id, session } as never }); if (result.isError) throw result.error; outputs.push(JSON.stringify(result.value)) }
  const acknowledged = await ctx.sessions.flush(session); const ns = Number(process.hrtime.bigint() - start); const digest = createHash('sha256').update(JSON.stringify(outputs)).digest('hex'); const events = session.events.length; await ctx.fiber.dispose(); return { ns, outputs, digest, events, acknowledged }
}
async function requireFreshRoot(root: string): Promise<void> { try { await lstat(root); throw new TypeError('persistenceRoot must not already exist') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }
export async function runG1Overhead(options: { outputPath: string; persistenceRoot: string }): Promise<unknown> {
  if (!isAbsolute(options.outputPath) || !isAbsolute(options.persistenceRoot)) throw new TypeError('outputPath and persistenceRoot must be absolute'); await requireFreshRoot(options.persistenceRoot)
  const warmupSamples: PairSample[] = []; const samples: PairSample[] = []; let outputDigest: string | undefined; let outputEqual = true; const eventCounts = { off: 0, on: 0 }; let persistenceAcknowledged = true
  for (const phase of ['warmup', 'measured'] as const) { const count = phase === 'warmup' ? WARMUP_PAIRS : MEASURED_PAIRS; for (let pair = 0; pair < count; pair++) { const order = alternation(pair); const roots = { off: resolve(options.persistenceRoot, phase, `off-${pair}`), on: resolve(options.persistenceRoot, phase, `on-${pair}`) }; const first = await arm(roots[order.first], order.first === 'on', pair); const second = await arm(roots[order.second], order.second === 'on', pair); const arms = { [order.first]: first, [order.second]: second } as Record<Arm, typeof first>; const equal = first.digest === second.digest && JSON.stringify(first.outputs) === JSON.stringify(second.outputs); outputDigest ??= first.digest; outputEqual &&= equal && first.digest === outputDigest; eventCounts.off += arms.off.events; eventCounts.on += arms.on.events; persistenceAcknowledged &&= first.acknowledged && second.acknowledged; const sample = { phase, pair, first: order.first, offNanoseconds: arms.off.ns, onNanoseconds: arms.on.ns, offEvents: arms.off.events, onEvents: arms.on.events, offAcknowledged: arms.off.acknowledged, onAcknowledged: arms.on.acknowledged, pairedRatio: ratio(arms.off.ns, arms.on.ns) } satisfies PairSample; (phase === 'warmup' ? warmupSamples : samples).push(sample) } }
  if (warmupSamples.length !== WARMUP_PAIRS || samples.length !== MEASURED_PAIRS || warmupSamples.some(sample => sample.phase !== 'warmup') || samples.some(sample => sample.phase !== 'measured') || [...warmupSamples, ...samples].some(sample => sample.offEvents !== 0 || sample.onEvents !== 2 * CALLS_PER_ARM || !sample.offAcknowledged || !sample.onAcknowledged) || !outputEqual || !persistenceAcknowledged || eventCounts.off !== 0 || eventCounts.on !== 2 * CALLS_PER_ARM * (WARMUP_PAIRS + MEASURED_PAIRS)) throw new Error('qualification invariants failed'); const analysis = analyze(samples); const out = { schema: 'flinter.g1-overhead.v1', protocol: { warmupPairs: WARMUP_PAIRS, measuredPairs: MEASURED_PAIRS, callsPerArm: CALLS_PER_ARM, seed: SEED, bootstrapResamples: BOOTSTRAP_RESAMPLES, confidence: 0.95, threshold: THRESHOLD, alternation: 'each phase resets: even OFF then ON; odd ON then OFF' }, runtime: { node: process.version, platform: process.platform, arch: process.arch }, workload: { operation: 'fixed deterministic candidate scoring/ranking', callsPerArm: CALLS_PER_ARM, candidateCount: CANDIDATE_COUNT }, warmupSamples, samples, analysis, outputEquality: outputEqual, outputDigest, eventCounts, persistenceAcknowledged, limitation: 'This result applies only to the frozen local deterministic workload.' }; await mkdir(dirname(options.outputPath), { recursive: true }); await writeFile(options.outputPath, JSON.stringify(out, null, 2) + '\n'); return out
}
export async function runG1Smoke(root: string): Promise<{ outputEqual: boolean; eventCounts: { off: number; on: number }; persistenceAcknowledged: boolean }> { if (!isAbsolute(root)) throw new TypeError('root must be absolute'); await requireFreshRoot(root); const off = await arm(resolve(root, 'off'), false, 0); const on = await arm(resolve(root, 'on'), true, 0); return { outputEqual: off.digest === on.digest && JSON.stringify(off.outputs) === JSON.stringify(on.outputs), eventCounts: { off: off.events, on: on.events }, persistenceAcknowledged: off.acknowledged && on.acknowledged } }
if (process.argv[1]?.endsWith('g1-overhead-qualification.ts')) { const outputPath = process.env.G1_OVERHEAD_OUTPUT; const persistenceRoot = process.env.G1_OVERHEAD_PERSISTENCE_ROOT; if (!outputPath || !persistenceRoot) throw new Error('G1_OVERHEAD_OUTPUT and G1_OVERHEAD_PERSISTENCE_ROOT are required'); await runG1Overhead({ outputPath, persistenceRoot }) }
