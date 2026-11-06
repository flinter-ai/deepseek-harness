/* oxlint-disable @stylistic/max-len */
import { Context } from '@deepseek-ai/cordis'
import * as decisionTrace from '@deepseek-ai/dsh-decision-trace'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import * as segmentationTrace from '../src/index.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Fixed-size benign event appended by the persistence-matched OFF arm so both arms materialize comparable logs. */
    'flinter-exp2/benign': { pad: string; call: number }
  }
}

const WARMUP_PAIRS = 5
const MEASURED_PAIRS = 30
const CALLS_PER_ARM = 64
const EVENTS_PER_CALL = 2
const CANDIDATE_COUNT = 24
const BOOTSTRAP_RESAMPLES = 10_000
const SEED = 20260919
const CAPTURE_BOUND_US_PER_CALL = 100
const PUBLISH_BOUND_MS = 25
const BYTE_PARITY_TOLERANCE = 0.1
const OVERLAP_WRITE_BATCH_DELAY_MS = 5
const BENIGN_PAD_BYTES = 350

type Arm = 'off' | 'on'
export interface Exp2PairSample { phase: 'warmup' | 'measured'; pair: number; first: Arm; offNanoseconds: number; onNanoseconds: number; offEvents: number; onEvents: number; offAcknowledged: boolean; onAcknowledged: boolean; offBytes: number; onBytes: number; offColdPublishMs: number; onColdPublishMs: number; offWarmPublishMs: number; onWarmPublishMs: number; captureUsPerCall: number; pairedRatio: number }
export interface PublishSample { kind: 'cold' | 'warm'; ms: number; bytes: number; events: number }
export interface OverlapSample { pair: number; loopMs: number; flushMs: number; events: number; acknowledged: boolean }
export interface PublishStats { n: number; p50Ms: number; p95Ms: number; maxMs: number; boundMs: number }
export interface Exp2Analysis { captureUsPerCallMedian: number; captureBoundUsPerCall: number; captureClassification: 'PASS' | 'FAIL'; pairedEstimate: number; pairedInterval: { lower: number; upper: number }; coldPublish: PublishStats; warmPublish: PublishStats; durabilityClassification: 'PASS' | 'FAIL'; classification: 'PASS' | 'FAIL' }

const finitePositive = (n: number) => Number.isFinite(n) && n > 0
const sorted = (xs: readonly number[]) => [...xs].sort((a, b) => a - b)
const median = (xs: readonly number[]) => { if (!xs.length) throw new TypeError('median requires samples'); return sorted(xs)[Math.floor(xs.length / 2)]! }
function publishStats(xs: readonly number[]): PublishStats { if (!xs.length) throw new TypeError('publish stats require samples'); const s = sorted(xs); return { n: s.length, p50Ms: s[Math.floor(s.length / 2)]!, p95Ms: s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]!, maxMs: s[s.length - 1]!, boundMs: PUBLISH_BOUND_MS } }
function rng(seed: number) { let x = seed >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 0x1_0000_0000 } }

export function analyze(samples: readonly Exp2PairSample[], seed = SEED, resamples = BOOTSTRAP_RESAMPLES): Exp2Analysis {
  if (!samples.length || !Number.isInteger(resamples) || resamples <= 0) throw new TypeError('samples must not be empty and resamples must be a positive integer')
  const capture = samples.map((sample) => { const computed = (sample.onNanoseconds - sample.offNanoseconds) / CALLS_PER_ARM / 1000; if (Math.abs(sample.captureUsPerCall - computed) > 1e-6) throw new TypeError('captureUsPerCall is inconsistent with timings'); return computed })
  const ratios = samples.map((sample) => { if (!finitePositive(sample.offNanoseconds) || !finitePositive(sample.onNanoseconds)) throw new TypeError('timings must be finite and positive'); const computed = (sample.onNanoseconds - sample.offNanoseconds) / sample.offNanoseconds; if (sample.pairedRatio !== computed) throw new TypeError('pairedRatio is inconsistent with timings'); return computed })
  const estimate = ratios.reduce((sum, value) => sum + value, 0) / ratios.length; const random = rng(seed); const boots = new Array<number>(resamples)
  for (let b = 0; b < resamples; b++) { let sum = 0; for (const _ of ratios) sum += ratios[Math.floor(random() * ratios.length)]!; boots[b] = sum / ratios.length }
  boots.sort((a, b) => a - b); const lower = boots[Math.floor(resamples * 0.025)]!; const upper = boots[Math.min(resamples - 1, Math.floor(resamples * 0.975))]!
  const cold = publishStats(samples.flatMap(sample => [sample.offColdPublishMs, sample.onColdPublishMs])); const warm = publishStats(samples.flatMap(sample => [sample.offWarmPublishMs, sample.onWarmPublishMs]))
  const captureUsPerCallMedian = median(capture)
  const captureClassification = captureUsPerCallMedian <= CAPTURE_BOUND_US_PER_CALL ? 'PASS' : 'FAIL'
  const durabilityClassification = cold.p50Ms <= PUBLISH_BOUND_MS && warm.p50Ms <= PUBLISH_BOUND_MS ? 'PASS' : 'FAIL'
  return { captureUsPerCallMedian, captureBoundUsPerCall: CAPTURE_BOUND_US_PER_CALL, captureClassification, pairedEstimate: estimate, pairedInterval: { lower, upper }, coldPublish: cold, warmPublish: warm, durabilityClassification, classification: captureClassification === 'PASS' && durabilityClassification === 'PASS' ? 'PASS' : 'FAIL' }
}

export function alternation(pair: number): { first: Arm; second: Arm } { return pair % 2 === 0 ? { first: 'off', second: 'on' } : { first: 'on', second: 'off' } }
function workload(): { output: string; digest: string } { const scored = Array.from({ length: CANDIDATE_COUNT }, (_, i) => ({ id: `candidate-${i}`, score: (i * 17 + 11) % 29 })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)); const output = JSON.stringify(scored.slice(0, 8)); return { output, digest: createHash('sha256').update(output).digest('hex') } }

async function dirBytes(root: string): Promise<number> { let total = 0; for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) { if (entry.isFile()) total += (await stat(join(entry.parentPath, entry.name))).size } return total }

/** Read every materialized log under root into a header-id → lines map, bypassing event-vocabulary validation. */
async function logsIn(root: string): Promise<Map<string, string[]>> {
  const logs = new Map<string, string[]>()
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    const lines = (await readFile(join(entry.parentPath, entry.name), 'utf8')).split('\n').filter(line => line.length > 0)
    const header = JSON.parse(lines[0]!) as { type?: string; id?: string }
    if (header.type === 'session' && header.id) logs.set(header.id, lines)
  }
  return logs
}

/** Verify the durable artifact post-flush: the log exists on disk, its header id matches, and it carries at least `events` committed event lines. */
function verifyDurableLog(logs: Map<string, string[]>, sessionId: string, events: number): void {
  const lines = logs.get(sessionId)
  if (!lines || lines.length < 1 + events) throw new Error(`durable verification failed for session ${sessionId}: expected at least ${events} event lines, found ${lines ? lines.length - 1 : 'no log'}`)
}

async function arm(root: string, enabled: boolean, pair: number, writeBatchMaxDelayMs?: number): Promise<{ ns: number; loopNs: number; flushNs: number; outputs: string[]; digest: string; events: number; acknowledged: boolean; bytes: number; warmPublishMs: number; warmBytes: number }> {
  const ctx = new Context(); await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none', packChunks: false, ...(writeBatchMaxDelayMs === undefined ? {} : { writeBatchMaxDelayMs }) }); await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  ctx.tools.register(defineTool({ name: 'segment.qualify', description: 'deterministic scoring fixture', parameters: {}, output: { schema: { type: 'object', additionalProperties: false, properties: { output: { type: 'string', required: true }, digest: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, async execute() { return workload() } }))
  if (enabled) await ctx.plugin(decisionTrace); if (enabled) await ctx.plugin(segmentationTrace, { toolName: 'segment.qualify', source: { request: () => ({ allowedActions: ['segment'], chosenAction: 'segment', requestedEvidenceRefs: [], fetchedEvidenceRefs: [], displayedEvidenceRefs: [], budgetBefore: 1, candidateRefs: ['fixture'], lineageRefs: [], sourceRef: 'g1', modelRef: 'deterministic', policyRevisionRef: 'g1' }), result: () => ({ outcome: 'success', disposition: 'retained' }) } })
  const session = ctx.sessions.create(SessionId(`g1-exp2-${enabled ? 'on' : 'off'}-${pair}`), { meta: { cwd: process.cwd() } })
  const t0 = process.hrtime.bigint(); const outputs: string[] = []
  for (let call = 0; call < CALLS_PER_ARM; call++) { const result = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId(`exp2-${pair}-${call}`), name: 'segment.qualify', arguments: {}, agent: { id: session.id, session } as never }); if (result.isError) throw result.error; outputs.push(JSON.stringify(result.value)); if (!enabled) { const pad = 'x'.repeat(BENIGN_PAD_BYTES); session.append('flinter-exp2/benign', { pad, call }); session.append('flinter-exp2/benign', { pad, call: -call - 1 }) } }
  const t1 = process.hrtime.bigint(); const acknowledged = await ctx.sessions.flush(session); const t2 = process.hrtime.bigint()
  const digest = createHash('sha256').update(JSON.stringify(outputs)).digest('hex'); const events = session.events.length; const bytes = await dirBytes(root)
  const warm = ctx.sessions.create(SessionId(`g1-exp2-warm-${enabled ? 'on' : 'off'}-${pair}`), { meta: { cwd: process.cwd() } }); const pad = 'x'.repeat(BENIGN_PAD_BYTES)
  const warmEvents = CALLS_PER_ARM * EVENTS_PER_CALL
  for (let call = 0; call < warmEvents; call++) warm.append('flinter-exp2/benign', { pad, call })
  const w0 = process.hrtime.bigint(); const warmAcknowledged = await ctx.sessions.flush(warm); const warmPublishMs = Number(process.hrtime.bigint() - w0) / 1e6; const warmBytes = (await dirBytes(root)) - bytes
  const logs = await logsIn(root); verifyDurableLog(logs, session.id, events); verifyDurableLog(logs, warm.id, warmEvents)
  if (!warmAcknowledged) throw new Error('warm session flush not acknowledged')
  await ctx.fiber.dispose(); return { ns: Number(t2 - t0), loopNs: Number(t1 - t0), flushNs: Number(t2 - t1), outputs, digest, events, acknowledged, bytes, warmPublishMs, warmBytes }
}

async function requireFreshRoot(root: string): Promise<void> { try { await lstat(root); throw new TypeError('persistenceRoot must not already exist') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }

async function runG1OverheadExp2(options: { outputPath: string; persistenceRoot: string }): Promise<unknown> {
  if (!isAbsolute(options.outputPath) || !isAbsolute(options.persistenceRoot)) throw new TypeError('outputPath and persistenceRoot must be absolute'); await requireFreshRoot(options.persistenceRoot)
  const warmupSamples: Exp2PairSample[] = []; const samples: Exp2PairSample[] = []; const publishSamples: PublishSample[] = []; const overlapSamples: OverlapSample[] = []; let outputDigest: string | undefined; let outputEqual = true; const eventCounts = { off: 0, on: 0 }; let persistenceAcknowledged = true
  for (const phase of ['warmup', 'measured'] as const) { const count = phase === 'warmup' ? WARMUP_PAIRS : MEASURED_PAIRS; for (let pair = 0; pair < count; pair++) { const order = alternation(pair); const roots = { off: resolve(options.persistenceRoot, phase, `off-${pair}`), on: resolve(options.persistenceRoot, phase, `on-${pair}`) }; const first = await arm(roots[order.first], order.first === 'on', pair); const second = await arm(roots[order.second], order.second === 'on', pair); const arms = { [order.first]: first, [order.second]: second } as Record<Arm, typeof first>; const equal = first.digest === second.digest && JSON.stringify(first.outputs) === JSON.stringify(second.outputs); outputDigest ??= first.digest; outputEqual &&= equal && first.digest === outputDigest; eventCounts.off += arms.off.events; eventCounts.on += arms.on.events; persistenceAcknowledged &&= first.acknowledged && second.acknowledged; for (const a of [arms.off, arms.on]) { publishSamples.push({ kind: 'cold', ms: a.flushNs / 1e6, bytes: a.bytes, events: a.events }, { kind: 'warm', ms: a.warmPublishMs, bytes: a.warmBytes, events: CALLS_PER_ARM * EVENTS_PER_CALL }) } const captureUsPerCall = (arms.on.ns - arms.off.ns) / CALLS_PER_ARM / 1000; const sample = { phase, pair, first: order.first, offNanoseconds: arms.off.ns, onNanoseconds: arms.on.ns, offEvents: arms.off.events, onEvents: arms.on.events, offAcknowledged: arms.off.acknowledged, onAcknowledged: arms.on.acknowledged, offBytes: arms.off.bytes, onBytes: arms.on.bytes, offColdPublishMs: arms.off.flushNs / 1e6, onColdPublishMs: arms.on.flushNs / 1e6, offWarmPublishMs: arms.off.warmPublishMs, onWarmPublishMs: arms.on.warmPublishMs, captureUsPerCall, pairedRatio: (arms.on.ns - arms.off.ns) / arms.off.ns } satisfies Exp2PairSample; (phase === 'warmup' ? warmupSamples : samples).push(sample) } }
  for (let pair = 0; pair < MEASURED_PAIRS; pair++) { const o = await arm(resolve(options.persistenceRoot, 'overlap', `on-${pair}`), true, pair, OVERLAP_WRITE_BATCH_DELAY_MS); overlapSamples.push({ pair, loopMs: o.loopNs / 1e6, flushMs: o.flushNs / 1e6, events: o.events, acknowledged: o.acknowledged }) }
  const byteParityOk = [...warmupSamples, ...samples].every(sample => Math.abs(sample.offBytes - sample.onBytes) / sample.onBytes <= BYTE_PARITY_TOLERANCE)
  if (warmupSamples.length !== WARMUP_PAIRS || samples.length !== MEASURED_PAIRS || [...warmupSamples, ...samples].some(sample => sample.offEvents !== EVENTS_PER_CALL * CALLS_PER_ARM || sample.onEvents !== EVENTS_PER_CALL * CALLS_PER_ARM || !sample.offAcknowledged || !sample.onAcknowledged) || !outputEqual || !persistenceAcknowledged || !byteParityOk || overlapSamples.some(sample => sample.events !== EVENTS_PER_CALL * CALLS_PER_ARM || !sample.acknowledged)) throw new Error('qualification invariants failed')
  const analysis = analyze(samples); const out = { schema: 'flinter.g1-overhead.v2', protocol: { warmupPairs: WARMUP_PAIRS, measuredPairs: MEASURED_PAIRS, callsPerArm: CALLS_PER_ARM, eventsPerCall: EVENTS_PER_CALL, benignPadBytes: BENIGN_PAD_BYTES, byteParityTolerance: BYTE_PARITY_TOLERANCE, seed: SEED, bootstrapResamples: BOOTSTRAP_RESAMPLES, confidence: 0.95, captureBoundUsPerCall: CAPTURE_BOUND_US_PER_CALL, publishBoundMs: PUBLISH_BOUND_MS, overlapWriteBatchMaxDelayMs: OVERLAP_WRITE_BATCH_DELAY_MS, alternation: 'each phase resets: even OFF then ON; odd ON then OFF', matching: 'OFF arm appends 2 benign fixed-size events per call so both arms materialize comparable logs; durable bytes must differ by ≤10%' }, harness: { file: 'packages/flinter/dsh-segmentation-decision-trace/tests/g1-overhead-exp2-qualification.ts' }, runtime: { node: process.version, platform: process.platform, arch: process.arch }, workload: { operation: 'fixed deterministic candidate scoring/ranking', callsPerArm: CALLS_PER_ARM, candidateCount: CANDIDATE_COUNT }, warmupSamples, samples, publishSamples, overlapSamples, analysis, outputEquality: outputEqual, outputDigest, eventCounts, persistenceAcknowledged, limitation: 'This result applies only to the frozen local deterministic workload; Metric C is report-only.' }; await mkdir(dirname(options.outputPath), { recursive: true }); await writeFile(options.outputPath, JSON.stringify(out, null, 2) + '\n'); return out
}

export async function runG1Exp2Smoke(root: string): Promise<{ outputEqual: boolean; eventCounts: { off: number; on: number }; bytes: { off: number; on: number }; persistenceAcknowledged: boolean }> { if (!isAbsolute(root)) throw new TypeError('root must be absolute'); await requireFreshRoot(root); const off = await arm(resolve(root, 'off'), false, 0); const on = await arm(resolve(root, 'on'), true, 0); return { outputEqual: off.digest === on.digest && JSON.stringify(off.outputs) === JSON.stringify(on.outputs), eventCounts: { off: off.events, on: on.events }, bytes: { off: off.bytes, on: on.bytes }, persistenceAcknowledged: off.acknowledged && on.acknowledged } }

if (process.argv[1]?.endsWith('g1-overhead-exp2-qualification.ts')) { const outputPath = process.env.G1_EXP2_OUTPUT; const persistenceRoot = process.env.G1_EXP2_PERSISTENCE_ROOT; if (!outputPath || !persistenceRoot) throw new Error('G1_EXP2_OUTPUT and G1_EXP2_PERSISTENCE_ROOT are required'); await runG1OverheadExp2({ outputPath, persistenceRoot }) }
