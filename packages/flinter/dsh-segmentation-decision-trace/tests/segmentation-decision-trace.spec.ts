import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as decisionTrace from '@deepseek-ai/dsh-decision-trace'
import type {
  DecisionResultEvent,
  DecisionStatus,
  Disposition,
} from '@deepseek-ai/dsh-decision-trace'
import { foldDecisionEpisodes } from '@deepseek-ai/dsh-decision-trace'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import * as segmentationTrace from '../src/index.ts'
import {
  createSegmentationDecisionAdapter,
  type SegmentationDecisionRequest,
  type SegmentationDecisionResult,
  type SegmentationDecisionSource,
} from '../src/index.ts'

const signal = new AbortController().signal
const sensitive = 'SENSITIVE_MARKER_DO_NOT_PERSIST'

function requestRecord(overrides: Partial<SegmentationDecisionRequest> = {}): SegmentationDecisionRequest {
  return {
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
  }
}

function resultRecord(overrides: Partial<SegmentationDecisionResult> = {}): SegmentationDecisionResult {
  return {
    outcome: 'success',
    disposition: 'retained',
    usage: 2,
    resultRefs: ['result:1'],
    evidenceRefs: ['evidence:observed'],
    lineageStatus: 'known',
    recordingReady: true,
    indexReady: false,
    ...overrides,
  }
}

function source(overrides: Partial<SegmentationDecisionSource> = {}): SegmentationDecisionSource {
  return {
    request: () => requestRecord(),
    result: () => resultRecord(),
    ...overrides,
  }
}

const segmentTool = defineTool({
  name: 'segment.select',
  description: 'fixture segmentation tool returning a deterministic value',
  parameters: { query: { type: 'string' } },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute(args) {
    return `segments:${args.query ?? 'default'}`
  },
})

const failingSegmentTool = defineTool({
  name: 'segment.failing',
  description: 'fixture segmentation tool that always fails',
  parameters: {},
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute() {
    throw new Error(sensitive)
  },
})

function fakeAgent(id: string): Agent {
  return { session: Session.create(SessionId(id)) } as unknown as Agent
}

interface Setup {
  toolName?: string
  source?: SegmentationDecisionSource
  tools?: readonly ToolDefinition[]
  registerAdapter?: boolean
}

async function setup(options: Setup = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  for (const tool of options.tools ?? [segmentTool]) ctx.tools.register(tool)
  await ctx.plugin(decisionTrace)
  const fiber = options.registerAdapter === false
    ? undefined
    : await ctx.plugin(segmentationTrace, {
      toolName: options.toolName ?? 'segment.select',
      source: options.source ?? source(),
    })
  return { ctx, fiber }
}

describe('segmentation decision adapter projection', () => {
  it('projects a full success pair into the bounded allowlist', () => {
    const adapter = createSegmentationDecisionAdapter(source())
    expect(adapter.projectSelection({} as never)).toEqual({
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
    })
    expect(adapter.projectResult({} as never, {} as never)).toEqual({
      outcome: 'success',
      usage: 2,
      disposition: 'retained',
      resultRefs: ['result:1'],
      evidenceRefs: ['evidence:observed'],
      lineageStatus: 'known',
      recordingReady: true,
      indexReady: false,
    })
  })

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
  ])('preserves the %s outcome', (outcome) => {
    const adapter = createSegmentationDecisionAdapter(source({
      result: () => resultRecord({ outcome }),
    }))
    expect(adapter.projectResult({} as never, {} as never).outcome).toBe(outcome)
  })

  it.each<Disposition>([
    'retained',
    'discarded',
    'abstained',
    'unavailable',
    'partial',
    'unknown',
  ])('preserves the %s disposition', (disposition) => {
    const adapter = createSegmentationDecisionAdapter(source({
      result: () => resultRecord({ disposition }),
    }))
    expect(adapter.projectResult({} as never, {} as never).disposition).toBe(disposition)
  })

  it('keeps unknown usage, lineage, readiness, and budget unmeasured', () => {
    const adapter = createSegmentationDecisionAdapter(source({
      request: () => requestRecord({ budgetBefore: null }),
      result: () => resultRecord({ usage: null, lineageStatus: 'unknown' }),
    }))
    expect(adapter.projectSelection({} as never).budgetBefore).toBeNull()
    expect(adapter.projectResult({} as never, {} as never)).toMatchObject({
      usage: null,
      lineageStatus: 'unknown',
    })
  })

  it('defaults omitted facts to empty, null, unknown, and false', () => {
    const adapter = createSegmentationDecisionAdapter(source({
      request: () => ({
        allowedActions: ['action:retain'],
        chosenAction: 'action:retain',
        sourceRef: 'source:fixture',
        modelRef: 'model:fixture',
        policyRevisionRef: 'policy:v1',
      }),
      result: () => ({ outcome: 'incomplete', disposition: 'unknown' }),
    }))
    expect(adapter.projectSelection({} as never)).toEqual({
      allowedActions: ['action:retain'],
      chosenAction: 'action:retain',
      parameterRefs: [],
      requestedEvidenceRefs: [],
      fetchedEvidenceRefs: [],
      displayedEvidenceRefs: [],
      observedEvidenceRefs: [],
      budgetBefore: null,
      candidateRefs: [],
      lineageRefs: [],
      sourceRef: 'source:fixture',
      modelRef: 'model:fixture',
      policyRevisionRef: 'policy:v1',
    })
    expect(adapter.projectResult({} as never, {} as never)).toEqual({
      outcome: 'incomplete',
      usage: null,
      disposition: 'unknown',
      resultRefs: [],
      evidenceRefs: [],
      lineageStatus: 'unknown',
      recordingReady: false,
      indexReady: false,
    })
  })

  it('rejects invalid, oversized, duplicate, and non-list references', () => {
    const adapter = createSegmentationDecisionAdapter(source())
    const invalidRequests = [
      requestRecord({ parameterRefs: ['has space'] }),
      requestRecord({ parameterRefs: [`ref:${'x'.repeat(160)}`] }),
      requestRecord({ candidateRefs: Array.from({ length: 33 }, (_, i) => `c:${i}`) }),
      requestRecord({ lineageRefs: ['same', 'same'] }),
      requestRecord({ parameterRefs: 'not-a-list' as never }),
      requestRecord({ sourceRef: '' }),
      requestRecord({ modelRef: 'https://example.invalid/x?y=1' }),
      requestRecord({ policyRevisionRef: 'has space' }),
    ]
    for (const record of invalidRequests) {
      const candidate = createSegmentationDecisionAdapter(source({ request: () => record }))
      expect(() => candidate.projectSelection({} as never)).toThrow()
    }
    const invalidResults = [
      resultRecord({ resultRefs: ['has space'] }),
      resultRecord({ evidenceRefs: [`ref:${'x'.repeat(160)}`] }),
      resultRecord({ resultRefs: Array.from({ length: 33 }, (_, i) => `r:${i}`) }),
      resultRecord({ evidenceRefs: ['same', 'same'] }),
      resultRecord({ resultRefs: 'not-a-list' as never }),
    ]
    for (const record of invalidResults) {
      const candidate = createSegmentationDecisionAdapter(source({ result: () => record }))
      expect(() => candidate.projectResult({} as never, {} as never)).toThrow()
    }
    expect(() => adapter.projectSelection({} as never)).not.toThrow()
  })

  it('rejects missing required facts and inconsistent choices', () => {
    const invalidRequests = [
      { ...requestRecord(), allowedActions: [] },
      { ...requestRecord(), chosenAction: 'action:absent' },
      { ...requestRecord(), sourceRef: undefined },
      { ...requestRecord(), modelRef: undefined },
      { ...requestRecord(), policyRevisionRef: undefined },
      null,
      'text',
      [],
    ]
    for (const record of invalidRequests) {
      const candidate = createSegmentationDecisionAdapter(source({
        request: () => record as never,
      }))
      expect(() => candidate.projectSelection({} as never)).toThrow()
    }
    const invalidResults = [
      { ...resultRecord(), outcome: 'made-up' as never },
      { ...resultRecord(), outcome: undefined as never },
      { ...resultRecord(), disposition: 'made-up' as never },
      { ...resultRecord(), disposition: undefined as never },
      { ...resultRecord(), lineageStatus: 'guessed' as never },
      { ...resultRecord(), recordingReady: 'yes' as never },
      { ...resultRecord(), indexReady: 1 as never },
      null,
      'text',
      [],
    ]
    for (const record of invalidResults) {
      const candidate = createSegmentationDecisionAdapter(source({
        result: () => record as never,
      }))
      expect(() => candidate.projectResult({} as never, {} as never)).toThrow()
    }
  })

  it('rejects invalid usage and budget numbers', () => {
    for (const usage of [-1, 1.5, 'two' as never, Number.MAX_SAFE_INTEGER + 1]) {
      const candidate = createSegmentationDecisionAdapter(source({
        result: () => resultRecord({ usage: usage as never }),
      }))
      expect(() => candidate.projectResult({} as never, {} as never)).toThrow()
    }
    for (const budgetBefore of [-1, 1.5, 'four' as never]) {
      const candidate = createSegmentationDecisionAdapter(source({
        request: () => requestRecord({ budgetBefore: budgetBefore as never }),
      }))
      expect(() => candidate.projectSelection({} as never)).toThrow()
    }
  })

  it('never copies unlisted producer fields into either projection', () => {
    const adapter = createSegmentationDecisionAdapter(source({
      request: () => ({
        ...requestRecord(),
        rawArguments: sensitive,
        prompt: sensitive,
      } as never),
      result: () => ({
        ...resultRecord(),
        providerPayload: sensitive,
        errorText: sensitive,
      } as never),
    }))
    const pair = JSON.stringify([
      adapter.projectSelection({} as never),
      adapter.projectResult({} as never, {} as never),
    ])
    expect(pair).not.toContain(sensitive)
    expect(pair).not.toContain('rawArguments')
    expect(pair).not.toContain('providerPayload')
  })

  it('fails closed when the producer source is malformed or throws', () => {
    expect(() => createSegmentationDecisionAdapter(null as never)).toThrow(/source/u)
    expect(() => createSegmentationDecisionAdapter({ request: () => requestRecord() } as never)).toThrow(/source/u)
    const throwing = createSegmentationDecisionAdapter({
      request: () => { throw new Error(sensitive) },
      result: () => { throw new Error(sensitive) },
    })
    expect(() => throwing.projectSelection({} as never)).toThrow()
    expect(() => throwing.projectResult({} as never, {} as never)).toThrow()
  })
})

describe('segmentation decision trace plugin', () => {
  it('registers under the exact tool name and captures a bounded pair', async () => {
    const { ctx } = await setup()
    expect(ctx.flinterDecisionTrace.adapter('segment.select')).toBeDefined()
    expect(ctx.flinterDecisionTrace.adapter('other.tool')).toBeUndefined()
    const owner = fakeAgent('segment-session')
    const outcome = await ctx.tools.execute({
      callId: ToolCallId('call-1'),
      name: 'segment.select',
      arguments: { query: sensitive },
      agent: owner,
      signal,
    })
    expect(outcome).toMatchObject({ isError: false, value: `segments:${sensitive}` })
    expect(owner.session.events.map(item => item.type)).toEqual([
      'flinter/decision-selection',
      'flinter/decision-result',
    ])
    const serialized = JSON.stringify(owner.session.events)
    expect(serialized).not.toContain(sensitive)
    expect(foldDecisionEpisodes(owner.session.events)).toMatchObject([{
      callId: 'call-1',
      toolName: 'segment.select',
      status: 'success',
    }])
  })

  it('leaves the tool result identical with and without tracing', async () => {
    const { ctx } = await setup({ registerAdapter: false })
    const untraced = fakeAgent('untraced')
    const before = await ctx.tools.execute({
      callId: ToolCallId('before'),
      name: 'segment.select',
      arguments: { query: 'q' },
      agent: untraced,
      signal,
    })
    await ctx.plugin(segmentationTrace, { toolName: 'segment.select', source: source() })
    const traced = fakeAgent('traced')
    const after = await ctx.tools.execute({
      callId: ToolCallId('after'),
      name: 'segment.select',
      arguments: { query: 'q' },
      agent: traced,
      signal,
    })
    expect(after).toMatchObject({ isError: false, value: 'segments:q' })
    expect(before).toMatchObject({ isError: false, value: 'segments:q' })
    expect(untraced.session.events).toHaveLength(0)
    expect(traced.session.events).toHaveLength(2)
  })

  it('preserves a failure outcome and never copies tool error text', async () => {
    const { ctx } = await setup({
      toolName: 'segment.failing',
      tools: [failingSegmentTool],
      source: source({
        result: (_exec, result) => resultRecord(
          result.isError
            ? { outcome: 'provider-error', disposition: 'unavailable', usage: null }
            : {},
        ),
      }),
    })
    const owner = fakeAgent('failing-session')
    const outcome = await ctx.tools.execute({
      callId: ToolCallId('call-fail'),
      name: 'segment.failing',
      arguments: {},
      agent: owner,
      signal,
    })
    expect(outcome.isError).toBe(true)
    const events = owner.session.events.map(item => item.type)
    expect(events).toEqual(['flinter/decision-selection', 'flinter/decision-result'])
    const resultEvent = owner.session.events[1] as { data: DecisionResultEvent }
    expect(resultEvent.data.projection.outcome).toBe('provider-error')
    expect(resultEvent.data.projection.usage).toBeNull()
    expect(JSON.stringify(owner.session.events)).not.toContain(sensitive)
    expect(JSON.stringify(owner.session.events)).not.toContain('Error')
  })

  it('fails loud on invalid config and source at mount', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(decisionTrace)
    await expect(async () => ctx.plugin(segmentationTrace, {
      toolName: '',
      source: source(),
    })).rejects.toThrow()
    await expect(async () => ctx.plugin(segmentationTrace, {
      toolName: 'segment.select',
      source: { request: () => requestRecord() } as never,
    })).rejects.toThrow()
    expect(ctx.flinterDecisionTrace.adapter('segment.select')).toBeUndefined()
  })

  it('rejects a duplicate registration and removes only its own adapter on dispose', async () => {
    const { ctx, fiber } = await setup()
    expect(fiber).toBeDefined()
    await expect(async () => ctx.plugin(segmentationTrace, {
      toolName: 'segment.select',
      source: source(),
    })).rejects.toThrow(/duplicate/u)
    await fiber?.dispose()
    expect(ctx.flinterDecisionTrace.adapter('segment.select')).toBeUndefined()

    const replacement = await ctx.plugin(segmentationTrace, {
      toolName: 'segment.select',
      source: source(),
    })
    const owner = fakeAgent('replacement')
    await ctx.tools.execute({
      callId: ToolCallId('replaced'),
      name: 'segment.select',
      arguments: {},
      agent: owner,
      signal,
    })
    expect(owner.session.events).toHaveLength(2)
    await replacement.dispose()
    await replacement.dispose()
    expect(ctx.flinterDecisionTrace.adapter('segment.select')).toBeUndefined()
  })

  it('contains adapter projection failures without changing the tool outcome', async () => {
    const { ctx } = await setup({
      source: {
        request: () => { throw new Error(sensitive) },
        result: () => resultRecord(),
      },
    })
    const owner = fakeAgent('containment')
    const outcome = await ctx.tools.execute({
      callId: ToolCallId('contained'),
      name: 'segment.select',
      arguments: {},
      agent: owner,
      signal,
    })
    expect(outcome.isError).toBe(false)
    expect(owner.session.events.map(item => item.type)).toEqual(['flinter/decision-result'])
    expect(ctx.flinterDecisionTrace.diagnostics).toEqual(['selection:projection-failed'])
    expect(JSON.stringify(owner.session.events)).not.toContain(sensitive)
  })
})
