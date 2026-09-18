import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as decisionTrace from '@deepseek-ai/dsh-decision-trace'
import { DecisionId, foldDecisionEpisodes } from '@deepseek-ai/dsh-decision-trace'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as segmentationTrace from '../src/index.ts'
import { createSegmentationDecisionAdapter, type SegmentationDecisionRequest, type SegmentationDecisionResult } from '../src/index.ts'

const secret = 'QUALIFICATION_SENSITIVE_THROWN_TEXT'
const signal = new AbortController().signal

const request = (overrides: Partial<SegmentationDecisionRequest> = {}): SegmentationDecisionRequest => ({
  allowedActions: ['action:keep'], chosenAction: 'action:keep', parameterRefs: [],
  requestedEvidenceRefs: [], fetchedEvidenceRefs: [], displayedEvidenceRefs: [], observedEvidenceRefs: [],
  budgetBefore: 0, candidateRefs: ['candidate:1'], lineageRefs: [], sourceRef: 'source:fixture',
  modelRef: 'model:fixture', policyRevisionRef: 'policy:v1', ...overrides,
})
const result = (overrides: Partial<SegmentationDecisionResult> = {}): SegmentationDecisionResult => ({
  outcome: 'success', disposition: 'retained', usage: 1, resultRefs: ['result:1'], evidenceRefs: [],
  lineageStatus: 'known', recordingReady: true, indexReady: false, ...overrides,
})

const tool = defineTool({
  name: 'segment.qualify.lifecycle', description: 'deterministic qualification tool', parameters: {},
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
  async execute() { return 'control-value' },
})

function agent(id: string): Agent { const session = Session.create(SessionId(id)); return { id, session } as unknown as Agent }
type SetupSource = { request: () => SegmentationDecisionRequest; result: () => SegmentationDecisionResult }
function setup(source: SetupSource): Promise<{ ctx: Context; fiber: NonNullable<Awaited<ReturnType<Context['plugin']>>> }>
function setup(source: SetupSource, register: false): Promise<{ ctx: Context; fiber: undefined }>
async function setup(source: SetupSource, register = true) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); ctx.tools.register(tool); await ctx.plugin(decisionTrace)
  const fiber = register ? await ctx.plugin(segmentationTrace, { toolName: tool.name, source }) : undefined
  return { ctx, fiber }
}
function event(data: Record<string, unknown>, phase: 'selection' | 'result', seq: number): SessionEvent {
  return { type: `flinter/decision-${phase}`, seq, time: seq, data: { ...data, phase } } as SessionEvent
}
function selection(id: string, projection = request()) { return { decisionId: DecisionId(`flinter-decision:${id}`), callId: id, toolName: tool.name, projection } }
function resultEvent(id: string, projection = result()) { return { decisionId: DecisionId(`flinter-decision:${id}`), callId: id, toolName: tool.name, projection } }

describe('G1 lifecycle and fault qualification', () => {
  it('disposes and remounts one adapter without duplicate capture or leaked ownership', async () => {
    const h = await setup({ request: () => request(), result: () => result() })
    try {
      const source = { request: () => request(), result: () => result() }
      await expect(h.ctx.plugin(segmentationTrace, { toolName: tool.name, source })).rejects.toThrow(/duplicate/u)
      await h.fiber.dispose()
      const replacement = await h.ctx.plugin(segmentationTrace, { toolName: tool.name, source })
      const owner = agent('lifecycle')
      await h.ctx.tools.execute({ callId: ToolCallId('same-call'), name: tool.name, arguments: {}, agent: owner, signal })
      expect(owner.session.events.map(e => e.type)).toEqual(['flinter/decision-selection', 'flinter/decision-result'])
      expect(owner.session.events).toHaveLength(2)
      await replacement.dispose()
      expect(h.ctx.flinterDecisionTrace.adapter(tool.name)).toBeUndefined()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('separates reused call IDs across sessions', async () => {
    const h = await setup({ request: () => request(), result: () => result() })
    try {
      const a = agent('session-a'); const b = agent('session-b')
      await h.ctx.tools.execute({ callId: ToolCallId('reused'), name: tool.name, arguments: {}, agent: a, signal })
      await h.ctx.tools.execute({ callId: ToolCallId('reused'), name: tool.name, arguments: {}, agent: b, signal })
      expect((a.session.events[0] as SessionEvent<'flinter/decision-selection'>).data.decisionId).not.toBe((b.session.events[0] as SessionEvent<'flinter/decision-selection'>).data.decisionId)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('contains projection faults with bounded diagnostics and explicit missing halves', async () => {
    const controlHarness = await setup({ request: () => request(), result: () => result() }, false)
    const control = agent('control')
    const expected = await controlHarness.ctx.tools.execute({ callId: ToolCallId('control'), name: tool.name, arguments: {}, agent: control, signal })
    const selectionHarness = await setup({ request: () => { throw new Error(secret) }, result: () => result() })
    const resultHarness = await setup({ request: () => request(), result: () => { throw new Error(secret) } })
    try {
      const selectionAgent = agent('selection-fault')
      const selectionActual = await selectionHarness.ctx.tools.execute({ callId: ToolCallId('selection-fault'), name: tool.name, arguments: {}, agent: selectionAgent, signal })
      expect(selectionActual).toMatchObject({ isError: expected.isError, value: expected.value })
      expect(selectionAgent.session.events).toHaveLength(1)
      expect(selectionAgent.session.events[0]?.type).toBe('flinter/decision-result')
      expect(selectionHarness.ctx.flinterDecisionTrace.diagnostics).toEqual(['selection:projection-failed'])
      expect(JSON.stringify(selectionAgent.session.events)).not.toContain(secret)

      const resultAgent = agent('result-fault')
      const resultActual = await resultHarness.ctx.tools.execute({ callId: ToolCallId('result-fault'), name: tool.name, arguments: {}, agent: resultAgent, signal })
      expect(resultActual).toMatchObject({ isError: expected.isError, value: expected.value })
      expect(resultAgent.session.events).toHaveLength(1)
      expect(resultHarness.ctx.flinterDecisionTrace.diagnostics).toEqual(['result:projection-failed'])
      expect(JSON.stringify(resultAgent.session.events)).not.toContain(secret)
    } finally {
      await controlHarness.ctx.fiber.dispose(); await selectionHarness.ctx.fiber.dispose(); await resultHarness.ctx.fiber.dispose()
    }
  })

  it('deduplicates exact replay and fails closed on immutable changes', () => {
    const s = selection('replay'); const r = resultEvent('replay')
    expect(foldDecisionEpisodes([event(s, 'selection', 0), event(s, 'selection', 1), event(r, 'result', 2), event(r, 'result', 3)])).toHaveLength(1)
    expect(() => foldDecisionEpisodes([event(s, 'selection', 0), event(selection('replay', request({ budgetBefore: 1 })), 'selection', 1)])).toThrow(/immutable decision identity/u)
    expect(() => foldDecisionEpisodes([event(s, 'selection', 0), event({ ...r, callId: 'changed' }, 'result', 1)])).toThrow(/pair identity/u)
  })

  it('enforces reference, list, and safe integer boundaries without echoing values', () => {
    const valid = createSegmentationDecisionAdapter({ request: () => request({ sourceRef: 'r'.repeat(160), candidateRefs: Array.from({ length: 32 }, (_, i) => `c:${i}`), budgetBefore: Number.MAX_SAFE_INTEGER }), result: () => result() })
    expect(valid.projectSelection({} as never).sourceRef).toHaveLength(160)
    for (const bad of [request({ sourceRef: 'r'.repeat(161) }), request({ candidateRefs: Array.from({ length: 33 }, (_, i) => `c:${i}`) }), request({ budgetBefore: Number.MAX_SAFE_INTEGER + 1 })]) {
      try { createSegmentationDecisionAdapter({ request: () => bad, result: () => result() }).projectSelection({} as never); throw new Error('boundary accepted') } catch (error) {
        expect(String(error)).not.toContain('r'.repeat(161)); expect(String(error)).not.toContain(String(Number.MAX_SAFE_INTEGER + 1))
      }
    }
  })

  it('folds 10,000 events into 5,000 deterministic episodes', () => {
    const events: SessionEvent[] = []
    for (let i = 0; i < 5000; i++) { const id = String(i); events.push(event(selection(id), 'selection', i * 2), event(resultEvent(id, result({ outcome: i % 2 ? 'abstention' : 'timeout' })), 'result', i * 2 + 1)) }
    const episodes = foldDecisionEpisodes(events)
    expect(episodes).toHaveLength(5000); expect(episodes[0]?.status).toBe('timeout'); expect(episodes[1]?.status).toBe('abstention')
  })
})
