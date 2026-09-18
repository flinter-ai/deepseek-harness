import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as decisionTrace from '../src/index.ts'
import {
  DecisionId,
  DecisionTraceService,
  foldDecisionEpisodes,
  type DecisionResultEvent,
  type DecisionSelectionEvent,
  type DecisionStatus,
  type DecisionTraceAdapter,
  type ResultProjection,
  type SelectionProjection,
} from '../src/index.ts'

const signal = new AbortController().signal
const sensitive = 'SENSITIVE_MARKER_DO_NOT_PERSIST'

function selection(id = 'a', overrides: Partial<SelectionProjection> = {}): DecisionSelectionEvent {
  return {
    decisionId: DecisionId(`flinter-decision:${id}`),
    callId: id,
    toolName: 'decision-probe',
    phase: 'selection',
    projection: {
      allowedActions: ['action:retain', 'action:discard'],
      chosenAction: 'action:retain',
      parameterRefs: ['parameter:default'],
      requestedEvidenceRefs: ['evidence:requested'],
      fetchedEvidenceRefs: ['evidence:fetched'],
      displayedEvidenceRefs: ['evidence:displayed'],
      observedEvidenceRefs: ['evidence:observed'],
      budgetBefore: 4,
      candidateRefs: ['candidate:1'],
      lineageRefs: ['lineage:1'],
      sourceRef: 'source:fixture',
      modelRef: 'model:fixture',
      policyRevisionRef: 'policy:v1',
      ...overrides,
    },
  }
}

function result(
  id = 'a',
  outcome: DecisionStatus = 'success',
  overrides: Partial<ResultProjection> = {},
): DecisionResultEvent {
  return {
    decisionId: DecisionId(`flinter-decision:${id}`),
    callId: id,
    toolName: 'decision-probe',
    phase: 'result',
    projection: {
      outcome,
      usage: 2,
      disposition: 'retained',
      resultRefs: ['result:1'],
      evidenceRefs: ['evidence:observed'],
      lineageStatus: 'known',
      recordingReady: true,
      indexReady: false,
      ...overrides,
    },
  }
}

function event(data: DecisionSelectionEvent | DecisionResultEvent, seq = 0): SessionEvent {
  return { type: `flinter/decision-${data.phase}`, seq, time: seq, data } as SessionEvent
}

function fakeAgent(id: string): Agent {
  return { session: Session.create(SessionId(id)) } as unknown as Agent
}

function adapter(
  selectionValue: SelectionProjection = selection().projection,
  resultValue: ResultProjection = result().projection,
): DecisionTraceAdapter {
  return {
    projectSelection: () => selectionValue,
    projectResult: () => resultValue,
  }
}

const probe = defineTool({
  name: 'decision-probe',
  description: 'returns a deterministic probe value',
  parameters: { secret: { type: 'string' } },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute(args) {
    return args.secret ?? 'ok'
  },
})

async function setup() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.tools.register(probe)
  const fiber = await ctx.plugin(decisionTrace)
  return { ctx, fiber }
}

describe('decision trace ToolRuntime capture', () => {
  it('records one bounded pair without raw arguments, content, or unknown adapter fields', async () => {
    const { ctx } = await setup()
    const owner = fakeAgent('session-a')
    ctx.flinterDecisionTrace.register('decision-probe', {
      projectSelection: () => ({
        ...selection().projection,
        unknownSensitiveField: sensitive,
      }),
      projectResult: () => ({
        ...result().projection,
        unknownSensitiveField: sensitive,
      }),
    })

    const outcome = await ctx.tools.execute({
      callId: ToolCallId('call-a'),
      name: 'decision-probe',
      arguments: { secret: sensitive },
      agent: owner,
      signal,
    })

    expect(outcome).toMatchObject({ isError: false, value: sensitive })
    expect(owner.session.events).toHaveLength(2)
    expect(owner.session.events.map(item => item.type)).toEqual([
      'flinter/decision-selection',
      'flinter/decision-result',
    ])
    const serialized = JSON.stringify(owner.session.events)
    expect(serialized).not.toContain(sensitive)
    expect(foldDecisionEpisodes(owner.session.events)).toMatchObject([{
      callId: 'call-a',
      toolName: 'decision-probe',
      status: 'success',
    }])
  })

  it('uses session and call identity without delimiter collisions', async () => {
    const { ctx } = await setup()
    ctx.flinterDecisionTrace.register('decision-probe', adapter())
    const first = fakeAgent('a:b')
    const second = fakeAgent('a')
    await ctx.tools.execute({
      callId: ToolCallId('c'), name: 'decision-probe', arguments: {}, agent: first, signal,
    })
    await ctx.tools.execute({
      callId: ToolCallId('b:c'), name: 'decision-probe', arguments: {}, agent: second, signal,
    })
    const firstId = (first.session.events[0] as SessionEvent<'flinter/decision-selection'>).data.decisionId
    const secondId = (second.session.events[0] as SessionEvent<'flinter/decision-selection'>).data.decisionId
    expect(firstId).not.toBe(secondId)
  })

  it('leaves unregistered and agentless executions untouched', async () => {
    const { ctx } = await setup()
    const owner = fakeAgent('session-unregistered')
    await ctx.tools.execute({
      callId: ToolCallId('unregistered'), name: 'decision-probe', arguments: {}, agent: owner, signal,
    })
    await ctx.tools.execute({
      callId: ToolCallId('agentless'), name: 'decision-probe', arguments: {}, signal,
    })
    expect(owner.session.events).toHaveLength(0)
  })

  it('contains selection and result projector failures without changing tool outcomes', async () => {
    const { ctx } = await setup()
    let failSelection = true
    let failResult = false
    const currentAdapter: DecisionTraceAdapter = {
      projectSelection: () => {
        if (failSelection) throw new Error(sensitive)
        return selection().projection
      },
      projectResult: () => {
        if (failResult) throw new Error(sensitive)
        return result().projection
      },
    }
    const first = fakeAgent('selection-failure')
    ctx.flinterDecisionTrace.register('decision-probe', currentAdapter)
    const selectionOutcome = await ctx.tools.execute({
      callId: ToolCallId('selection-failure'), name: 'decision-probe', arguments: {}, agent: first, signal,
    })
    expect(selectionOutcome.isError).toBe(false)
    expect(first.session.events.map(item => item.type)).toEqual(['flinter/decision-result'])
    expect(ctx.flinterDecisionTrace.diagnostics).toEqual(['selection:projection-failed'])

    const second = fakeAgent('result-failure')
    failSelection = false
    failResult = true
    const resultOutcome = await ctx.tools.execute({
      callId: ToolCallId('result-failure'), name: 'decision-probe', arguments: {}, agent: second, signal,
    })
    expect(resultOutcome.isError).toBe(false)
    expect(second.session.events.map(item => item.type)).toEqual(['flinter/decision-selection'])
    expect(ctx.flinterDecisionTrace.diagnostics).toEqual([
      'selection:projection-failed',
      'result:projection-failed',
    ])
  })

  it('removes adapter and plugin effects without duplicate capture after reinstall', async () => {
    const { ctx, fiber } = await setup()
    const firstAdapter = adapter()
    const remove = ctx.flinterDecisionTrace.register('decision-probe', firstAdapter)
    expect(() => ctx.flinterDecisionTrace.register('decision-probe', adapter())).toThrow(/duplicate/u)
    remove()
    const secondAdapter = adapter()
    ctx.flinterDecisionTrace.register('decision-probe', secondAdapter)
    remove()
    expect(ctx.flinterDecisionTrace.adapter('decision-probe')).toBe(secondAdapter)

    const owner = fakeAgent('lifecycle')
    await fiber.dispose()
    expect(ctx.get('flinterDecisionTrace')).toBeUndefined()
    await ctx.tools.execute({
      callId: ToolCallId('disposed'), name: 'decision-probe', arguments: {}, agent: owner, signal,
    })
    expect(owner.session.events).toHaveLength(0)

    await ctx.plugin(decisionTrace)
    ctx.flinterDecisionTrace.register('decision-probe', adapter())
    await ctx.tools.execute({
      callId: ToolCallId('reinstalled'), name: 'decision-probe', arguments: {}, agent: owner, signal,
    })
    expect(owner.session.events).toHaveLength(2)
  })

  it('rejects invalid registrations and caps diagnostics', () => {
    const service = new DecisionTraceService()
    expect(() => service.register('', adapter())).toThrow(/tool name/u)
    for (let index = 0; index < 140; index += 1) {
      service.recordDiagnostic('selection:projection-failed')
    }
    expect(service.diagnostics).toHaveLength(128)
  })
})

describe('decision trace replay', () => {
  it.each<DecisionStatus>([
    'success',
    'rejection',
    'abstention',
    'unavailable-evidence',
    'malformed-response',
    'provider-error',
    'timeout',
    'exhaustion',
    'partial-retention',
    'export-conflict',
    'replay',
    'restart',
    'cancelled',
    'incomplete',
    'unknown',
  ])('preserves the %s outcome', (status) => {
    expect(foldDecisionEpisodes([event(selection()), event(result('a', status), 1)])[0]?.status).toBe(status)
  })

  it('keeps either half of a pair explicitly incomplete', () => {
    expect(foldDecisionEpisodes([event(selection('selection-only'))])[0]?.status).toBe('incomplete')
    expect(foldDecisionEpisodes([event(result('result-only'))])[0]?.status).toBe('incomplete')
    expect(foldDecisionEpisodes([
      event(selection('unknown-usage', { budgetBefore: null })),
      event(result('unknown-usage', 'success', { usage: null }), 1),
    ])[0]?.result?.projection.usage).toBeNull()
  })

  it('deduplicates exact replay and rejects phase or pair identity conflicts', () => {
    const selected = selection('duplicate')
    expect(foldDecisionEpisodes([event(selected), event(selected, 1)])).toHaveLength(1)
    expect(() => foldDecisionEpisodes([
      event(selected),
      event({ ...selected, projection: { ...selected.projection, budgetBefore: 3 } }, 1),
    ])).toThrow(/immutable decision identity/u)
    expect(() => foldDecisionEpisodes([
      event(selected),
      event({ ...result('duplicate'), callId: 'changed' }, 1),
    ])).toThrow(/pair identity/u)
  })

  it('validates durable selection fields at replay', () => {
    expect(() => foldDecisionEpisodes([{
      type: 'flinter/decision-selection',
      seq: 0,
      time: 0,
      data: { ...selection(), phase: 'result' },
    } as never])).toThrow(/selection phase/u)
    const invalid = [
      { ...selection(), decisionId: DecisionId('wrong-prefix') },
      selection('empty-actions', { allowedActions: [] }),
      selection('wrong-choice', { chosenAction: 'action:missing' }),
      selection('duplicate-ref', { parameterRefs: ['same', 'same'] }),
      selection('bad-ref', { sourceRef: 'contains space' }),
      selection('too-many', { candidateRefs: Array.from({ length: 33 }, (_, index) => `c:${index}`) }),
      selection('bad-budget', { budgetBefore: -1 }),
      selection('not-array', { lineageRefs: 'bad' as never }),
    ]
    for (const candidate of invalid) {
      expect(() => foldDecisionEpisodes([event(candidate)])).toThrow()
    }
  })

  it('validates durable result fields at replay', () => {
    expect(() => foldDecisionEpisodes([{
      type: 'flinter/decision-result',
      seq: 0,
      time: 0,
      data: { ...result(), phase: 'selection' },
    } as never])).toThrow(/result phase/u)
    const invalid = [
      result('bad-outcome', 'invalid' as DecisionStatus),
      result('bad-disposition', 'success', { disposition: 'invalid' as never }),
      result('bad-lineage', 'success', { lineageStatus: 'invalid' as never }),
      result('bad-ready', 'success', { recordingReady: 'yes' as never }),
      result('bad-usage', 'success', { usage: 1.5 }),
      result('not-number', 'success', { usage: 'two' as never }),
    ]
    for (const candidate of invalid) {
      expect(() => foldDecisionEpisodes([event(candidate)])).toThrow()
    }
  })

  it('ignores unrelated events and folds a 10,000-event multi-run log', () => {
    const events: SessionEvent[] = [{ type: 'session/start', seq: 0, time: 0, data: {} } as SessionEvent]
    for (let index = 0; index < 5_000; index += 1) {
      const id = String(index)
      events.push(event(selection(id), index * 2 + 1))
      events.push(event(result(id, index % 2 === 0 ? 'timeout' : 'abstention'), index * 2 + 2))
    }
    const episodes = foldDecisionEpisodes(events)
    expect(episodes).toHaveLength(5_000)
    expect(episodes[0]?.status).toBe('timeout')
    expect(episodes[1]?.status).toBe('abstention')
  })

  it('replays a JSON-round-tripped pair after a detached session restart', () => {
    const seed = structuredClone([event(selection('restart')), event(result('restart'), 1)])
    const resumed = Session.create(SessionId('resumed-session'), seed)
    expect(foldDecisionEpisodes(resumed.events)).toMatchObject([{
      callId: 'restart',
      status: 'success',
    }])
  })
})
