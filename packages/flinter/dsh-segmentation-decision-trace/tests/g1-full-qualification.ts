import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import * as decisionTrace from '@deepseek-ai/dsh-decision-trace'
import { HarnessError, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool, TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import type { ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import * as timeoutPolicy from '@deepseek-ai/dsh-tool-call-timeout-policy'
import * as segmentationTrace from '../src/index.ts'
import type { SegmentationDecisionRequest, SegmentationDecisionSource } from '../src/types.ts'

/* oxlint-disable @stylistic/max-len */

type R = Record<string, unknown>
const isR = (x: unknown): x is R => typeof x === 'object' && x !== null && !Array.isArray(x)
const has = (x: R, k: string) => Object.prototype.hasOwnProperty.call(x, k)
const strings = (x: unknown, name: string): string[] => { if (!Array.isArray(x) || x.some(v => typeof v !== 'string')) throw new TypeError(`invalid ${name}`); return [...x] }
export type G1CaseInput = { case_id: string; call_id: string; candidate_ref: string; stimulus: R; request: SegmentationDecisionRequest }
export type G1TestData = { scope: string; sessionId: string; toolName: string; timeoutMs: number; cases: G1CaseInput[] }
export interface G1FullOutput { schema: 'flinter.g1-session-events.v1'; scope: string; provenance: R; events: readonly unknown[]; toolResults: readonly R[]; persistenceAck: boolean; reloadEquality: R; diagnostics: readonly string[]; session: R; rawArtifact: R }

export function parseTestData(v: unknown): G1TestData {
  if (!isR(v) || v.schema !== 'flinter.g1-runtime-input.v1' || typeof v.scope !== 'string' || typeof v.settled_session_id !== 'string' || typeof v.tool_name !== 'string' || typeof v.timeout_ms !== 'number' || !Number.isFinite(v.timeout_ms) || v.timeout_ms <= 0 || !isR(v.request_defaults) || !Array.isArray(v.cases)) throw new TypeError('invalid input schema')
  const d = v.request_defaults, caseIds = new Set<string>(), callIds = new Set<string>(), cases: G1CaseInput[] = []
  for (const x of v.cases) {
    if (!isR(x) || x.execution_group !== 'settled') continue
    if (typeof x.case_id !== 'string' || typeof x.call_id !== 'string' || typeof x.candidate_ref !== 'string' || caseIds.has(x.case_id) || callIds.has(x.call_id) || !isR(x.stimulus)) throw new TypeError('invalid case')
    caseIds.add(x.case_id); callIds.add(x.call_id); const o = isR(x.request_overrides) ? x.request_overrides : {}; const get = (k: string) => has(o, k) ? o[k] : d[k]; const s = x.stimulus
    if (typeof s.kind !== 'string' || !['return', 'throw', 'timeout', 'cancel'].includes(s.kind)) throw new TypeError('invalid stimulus')
    if (typeof d.chosen_action !== 'string' || typeof d.source_ref !== 'string' || typeof d.model_ref !== 'string' || typeof d.policy_revision_ref !== 'string') throw new TypeError('invalid request defaults')
    cases.push({ case_id: x.case_id, call_id: x.call_id, candidate_ref: x.candidate_ref, stimulus: s, request: { allowedActions: strings(d.allowed_actions, 'allowed_actions'), chosenAction: d.chosen_action, parameterRefs: [], requestedEvidenceRefs: strings(get('requested_evidence_refs'), 'requested_evidence_refs'), fetchedEvidenceRefs: strings(get('fetched_evidence_refs'), 'fetched_evidence_refs'), displayedEvidenceRefs: strings(get('displayed_evidence_refs'), 'displayed_evidence_refs'), observedEvidenceRefs: strings(get('observed_evidence_refs'), 'observed_evidence_refs'), budgetBefore: get('budget_before') as number | null, candidateRefs: [x.candidate_ref], lineageRefs: [], sourceRef: d.source_ref, modelRef: d.model_ref, policyRevisionRef: d.policy_revision_ref } })
  }
  if (cases.length !== 12) throw new TypeError('expected 12 settled cases')
  return { scope: v.scope, sessionId: v.settled_session_id, toolName: v.tool_name, timeoutMs: v.timeout_ms, cases }
}
class FixtureStimulusError extends HarnessError { constructor(code: string) { super(code, code) } }
const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex')
const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    outcome: { type: 'string', required: true }, disposition: { type: 'string', required: true },
    usage: { oneOf: [{ type: 'integer' }, { type: 'null' }] as const, required: true },
    resultRefs: { type: 'array', items: { type: 'string' }, required: true },
    evidenceRefs: { type: 'array', items: { type: 'string' }, required: true },
    lineageStatus: { type: 'string', required: true }, recordingReady: { type: 'boolean', required: true },
    indexReady: { type: 'boolean', required: true },
  },
} as const satisfies ValueSchemaSpec
type G1ToolOutput = { outcome: string; disposition: string; usage: number | null; resultRefs: string[]; evidenceRefs: string[]; lineageStatus: string; recordingReady: boolean; indexReady: boolean }
const projection = (x: R): G1ToolOutput => ({ outcome: x.outcome as string, disposition: x.disposition as string, usage: (x.usage as number | null | undefined) ?? null, resultRefs: (x.result_refs as string[] | undefined) ?? [], evidenceRefs: (x.evidence_refs as string[] | undefined) ?? [], lineageStatus: (x.lineage_status as string | undefined) ?? 'unknown', recordingReady: (x.recording_ready as boolean | undefined) ?? false, indexReady: (x.index_ready as boolean | undefined) ?? false })

export async function runG1Full(o: { input: G1TestData; inputPath?: string; outputPath?: string; persistenceRoot?: string }): Promise<G1FullOutput> {
  const root = resolve(o.persistenceRoot ?? '/tmp/g1-full-persistence')
  try { await access(root); throw new Error('persistence root must not already exist') } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
  await mkdir(root); const map = new Map(o.input.cases.map(c => [c.call_id, c])), entered = new Map<string, Promise<void>>(), resolveEntered = new Map<string, () => void>()
  for (const c of o.input.cases) entered.set(c.call_id, new Promise<void>(r => resolveEntered.set(c.call_id, r)))
  const ctx = new Context(); await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none', packChunks: false }); await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(timeoutPolicy)
  ctx.tools.register(defineTool({ name: o.input.toolName, description: 'fixture', timeoutMs: o.input.timeoutMs, parameters: { callId: { type: 'string', required: true } }, output: { schema: outputSchema, render: () => [] }, async execute(a, e) {
    const c = map.get(a.callId); if (!c) throw new Error('unknown call'); resolveEntered.get(c.call_id)?.(); if (c.stimulus.kind === 'throw') throw new FixtureStimulusError(String(c.stimulus.error_code))
    if (c.stimulus.kind === 'timeout' || c.stimulus.kind === 'cancel') return await new Promise<G1ToolOutput>(resolve => e.signal.addEventListener('abort', () => resolve(projection({ outcome: c.stimulus.kind === 'timeout' ? 'timeout' : 'cancelled', disposition: 'unknown' })), { once: true }))
    return projection(c.stimulus)
  } }))
  await ctx.plugin(decisionTrace); const source: SegmentationDecisionSource = { request: e => map.get(String(e.callId))!.request, result: (_e, r) => { const code = r.error?.info?.code; if (code === 'FIXTURE_MALFORMED_RESPONSE') return { outcome: 'malformed-response', disposition: 'discarded' }; if (code === 'FIXTURE_PROVIDER_ERROR') return { outcome: 'provider-error', disposition: 'unknown' }; if (code === 'TOOL_TIMEOUT') return { outcome: 'timeout', disposition: 'unknown' }; if (code === TOOL_ABORTED || code === 'ABORTED') return { outcome: 'cancelled', disposition: 'unknown' }; if (!r.isError && isR(r.value)) return r.value as never; throw new Error(`unexpected tool result code: ${String(code)}`) } }
  await ctx.plugin(segmentationTrace, { toolName: o.input.toolName, source }); const session = ctx.sessions.create(SessionId(o.input.sessionId), { meta: { cwd: process.cwd() } }); const agent = { id: session.id, session } as never; const results: R[] = []
  for (const c of o.input.cases) { const controller = new AbortController(); const execute = ctx.tools.execute({ signal: controller.signal, callId: ToolCallId(c.call_id), name: o.input.toolName, arguments: { callId: c.call_id }, agent }); await entered.get(c.call_id); if (c.stimulus.kind === 'cancel') controller.abort(); const r = await execute; results.push({ sessionId: o.input.sessionId, caseId: c.case_id, callId: c.call_id, decisionId: `flinter-decision:${o.input.sessionId.length}:${o.input.sessionId}${c.call_id.length}:${c.call_id}`, toolName: o.input.toolName, isError: r.isError, entered: true, ...(r.isError ? { errorCode: r.error.info?.code, errorName: r.error.info?.name } : { value: r.value }) }) }
  const ack = await ctx.sessions.flush(session); const liveEvents = [...session.events]; const diagnostics = [...ctx.flinterDecisionTrace.diagnostics]; await ctx.fiber.dispose()
  const reload = new Context(); await reload.plugin(JsonlSessionPersistence, { root, compression: 'none', packChunks: false }); await reload.plugin(SessionStore); const loaded = await reload.sessionPersistence.load(SessionId(o.input.sessionId)); const raw = await reload.sessionPersistence.readRaw(SessionId(o.input.sessionId)); if (!raw) throw new Error('missing raw artifact'); await reload.fiber.dispose(); const events = loaded.events
  const inputBytes = o.inputPath ? await readFile(o.inputPath) : undefined; const out: G1FullOutput = { schema: 'flinter.g1-session-events.v1', scope: o.input.scope, provenance: { harness: 'dsh-segmentation-decision-trace/tests/g1-full-qualification.ts', node: process.version, ...(o.inputPath ? { inputPath: resolve(o.inputPath), inputSha256: createHash('sha256').update(inputBytes!).digest('hex') } : {}), persistence: 'jsonl-reloaded', provider: 'local-deterministic-tool-only', rootMode: 'external' }, events, toolResults: results, persistenceAck: ack, reloadEquality: { equal: digest(liveEvents) === digest(events), liveCount: liveEvents.length, reloadedCount: events.length, liveDigest: digest(liveEvents), reloadedDigest: digest(events) }, diagnostics, session: { sessionId: o.input.sessionId, header: loaded.meta, events }, rawArtifact: { digest: createHash('sha256').update(raw.content).digest('hex'), byteCount: Buffer.byteLength(raw.content) } }
  const output = o.outputPath ?? process.env.G1_FULL_OUTPUT ?? '/tmp/g1-full.json'; await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(out, null, 2)); return out
}
if (import.meta.url === `file://${process.argv[1]}`) { const inputPath = process.env.G1_FULL_INPUT; const outputPath = process.env.G1_FULL_OUTPUT; const persistenceRoot = process.env.G1_FULL_PERSISTENCE_ROOT; if (!inputPath || !outputPath || !persistenceRoot) throw new Error('G1_FULL_INPUT, G1_FULL_OUTPUT, and G1_FULL_PERSISTENCE_ROOT are required'); const input = parseTestData(JSON.parse(await readFile(inputPath, 'utf8'))); const out = await runG1Full({ input, inputPath, outputPath, persistenceRoot }); console.log(`g1-full events=${out.events.length} results=${out.toolResults.length} output=${resolve(outputPath)}`) }
