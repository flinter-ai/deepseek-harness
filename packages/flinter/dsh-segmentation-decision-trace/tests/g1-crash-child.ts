import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import * as decisionTrace from '@deepseek-ai/dsh-decision-trace'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as checkpointPolicy from '@deepseek-ai/dsh-session-checkpoint-policy'
import * as segmentationTrace from '../src/index.ts'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import type { SegmentationDecisionRequest } from '../src/types.ts'
type Input = {
  schema: string
  interrupted_session_id: string
  tool_name: string
  request_defaults: Record<string, unknown>
  cases: Array<Record<string, unknown>>
}
const [mode, root, marker, inputPath] = process.argv.slice(2)
if ((mode !== 'before-ack' && mode !== 'after-ack') || !root || !marker || !inputPath) throw new Error('usage: g1-crash-child.ts <mode> <root> <marker> <input>')
const raw = await readFile(inputPath); const input = JSON.parse(raw.toString()) as Input
if (input.schema !== 'flinter.g1-runtime-input.v1') throw new Error('invalid G1 input schema')
const matches = input.cases.filter(item => item.execution_group === 'crash-after-selection-ack')
if (matches.length !== 1) throw new Error('expected exactly one crash case')
const item = matches[0]
if (item === undefined) throw new Error('crash case is missing')
const sessionId = SessionId(input.interrupted_session_id)
const callId = String(item.call_id)
const toolName = input.tool_name
const overrides = (item.request_overrides ?? {}) as Record<string, unknown>
const request = {
  allowedActions: (overrides.allowed_actions ?? input.request_defaults.allowed_actions) as readonly string[],
  chosenAction: (overrides.chosen_action ?? input.request_defaults.chosen_action) as string,
  requestedEvidenceRefs: (overrides.requested_evidence_refs ?? input.request_defaults.requested_evidence_refs) as readonly string[],
  fetchedEvidenceRefs: (overrides.fetched_evidence_refs ?? input.request_defaults.fetched_evidence_refs) as readonly string[],
  displayedEvidenceRefs: (overrides.displayed_evidence_refs ?? input.request_defaults.displayed_evidence_refs) as readonly string[],
  observedEvidenceRefs: (overrides.observed_evidence_refs ?? input.request_defaults.observed_evidence_refs) as readonly string[],
  budgetBefore: (overrides.budget_before ?? input.request_defaults.budget_before) as number | null,
  candidateRefs: [String(item.candidate_ref)],
  sourceRef: (overrides.source_ref ?? input.request_defaults.source_ref) as string,
  modelRef: (overrides.model_ref ?? input.request_defaults.model_ref) as string,
  policyRevisionRef: (overrides.policy_revision_ref ?? input.request_defaults.policy_revision_ref) as string,
} satisfies SegmentationDecisionRequest
const digest = (events: readonly unknown[]) => createHash('sha256').update(JSON.stringify(events)).digest('hex'); const wait = () => new Promise<never>(() => { setInterval(() => {}, 60_000) })
const ctx = new Context(); await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none', packChunks: false }); await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(decisionTrace)
await ctx.plugin(segmentationTrace, { toolName, source: { request: () => request, result: () => ({ outcome: 'success', disposition: 'retained', usage: null, resultRefs: [], evidenceRefs: [], lineageStatus: 'known', recordingReady: true, indexReady: true }) } })
const session = ctx.sessions.create(sessionId, { meta: { cwd: process.cwd() } }); const agent = { id: session.id, session } as never; const selected = () => session.events.filter(event => event.type === 'flinter/decision-selection')
if (mode === 'before-ack') { ctx.on('tools/pre-execute', async (): Promise<PreToolDecision> => { const events = [...session.events]; if (selected().length !== 1 || events.some(event => event.type === 'flinter/decision-result')) throw new Error('unexpected pre-ack trace'); await writeFile(marker, JSON.stringify({ mode, persistenceAck: false, liveEventCount: events.length, liveDigest: digest(events), inputSha256: createHash('sha256').update(raw).digest('hex') })); await wait(); return { kind: 'allow' } }) } else await ctx.plugin(checkpointPolicy)
ctx.tools.register(defineTool({ name: toolName, description: 'crash qualification fixture', parameters: { callId: { type: 'string', required: true } }, output: { schema: { type: 'object', additionalProperties: false, properties: { outcome: { type: 'string', required: true } } }, render: () => [] }, async execute() { const ack = await ctx.sessions.flush(session); const events = [...session.events]; if (!ack || selected().length !== 1 || events.some(event => event.type === 'flinter/decision-result')) throw new Error('unexpected post-ack trace'); await writeFile(marker, JSON.stringify({ mode, persistenceAck: ack, liveEventCount: events.length, liveDigest: digest(events), inputSha256: createHash('sha256').update(raw).digest('hex') })); await wait(); return { outcome: 'success' } } }))
await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId(callId), name: toolName, arguments: { callId }, agent })
