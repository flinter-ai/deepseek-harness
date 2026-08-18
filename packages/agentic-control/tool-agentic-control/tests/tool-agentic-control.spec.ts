import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import InvestigationService from '@deepseek-ai/dsh-agentic-control'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as toolAgenticControl from '@deepseek-ai/dsh-tool-agentic-control'

const testToolSignal = new AbortController().signal

interface StubAgent {
  readonly agent: Agent
  readonly session: Session
}

/** Build one registry-compatible live agent. */
function stubAgent(rawId: string): StubAgent {
  const session = Session.create(SessionId(rawId))
  const status: AgentStatus = 'running'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    get status() { return status },
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { this.inbox.append('next-step', input) },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, session }
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(InvestigationService)
  const fiber = await ctx.plugin(toolAgenticControl)
  const root = stubAgent(`investigation-tool-root-${Math.random()}`)
  ctx.agents.register(root.agent)
  return { ctx, fiber, root }
}

/** Execute one registered tool on behalf of an agent. */
function execute(ctx: Context, name: string, args: unknown, agent?: Agent): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${Math.random()}`),
    name,
    arguments: args,
    ...agent === undefined ? {} : { agent },
  })
}

/** Parse the compact JSON returned by a successful investigation tool. */
function resultJson(result: ToolExecutionResult): Record<string, unknown> {
  expect(result.isError).toBe(false)
  if (result.isError) throw new Error('expected investigation tool success')
  const block = result.content[0]
  if (block?.type !== 'text') throw new Error('expected text tool result')
  return JSON.parse(block.text) as Record<string, unknown>
}

/** Assert one model-visible failure carrying a stable code or message. */
function resultError(result: ToolExecutionResult, pattern: RegExp): void {
  expect(result.isError).toBe(true)
  if (!result.isError) throw new Error('expected investigation tool failure')
  const block = result.content[0]
  if (block?.type !== 'text') throw new Error('expected text tool error')
  expect(block.text).toMatch(pattern)
}

const START_REQUEST = {
  candidateId: 'C17',
  actionFamily: 'pick-place',
  window: 't=10..20',
  requirements: ['physical assessment'],
}

/** Start the session investigation through the privileged channel. */
async function startedHarness() {
  const scope = await harness()
  scope.ctx.investigations.start(scope.root.agent, START_REQUEST)
  return scope
}

/** Run the pre-step waterfall and return the decision. */
async function preStep(ctx: Context, agent: Agent, proposed: readonly UserMessage[] = []): Promise<PreStepDecision> {
  return agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [...proposed], turn: 1, step: 1, signal: testToolSignal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [...proposed] }),
  )
}

describe('investigation tool registration and presentation', () => {
  it('registers three tools plus guidance and disposes all contributions', async () => {
    const { ctx, fiber } = await harness()
    expect(['run_physical_assessment', 'finish_investigation', 'stop_unknown'].map(name => ctx.tools.get(name)?.name))
      .toEqual(['run_physical_assessment', 'finish_investigation', 'stop_unknown'])
    const section = (await ctx.systemPrompt.assemble()).sections.find(item => item.name === 'tool:agentic-control')
    expect(section?.text).toContain('never by you')
    expect(section?.text).toContain('consumes one budgeted attempt')

    await fiber.dispose()
    expect(ctx.tools.get('run_physical_assessment')).toBeUndefined()
    expect((await ctx.systemPrompt.assemble()).sections.some(item => item.name === 'tool:agentic-control')).toBe(false)
  })

  it('uses args-only generic render intent', async () => {
    const { ctx } = await harness()
    expect(ctx.tools.get('run_physical_assessment')?.presentCall?.({})).toEqual({
      card: 'generic', title: 'Run physical assessment', kind: 'other',
    })
    expect(ctx.tools.get('finish_investigation')?.presentCall?.({})).toEqual({
      card: 'generic', title: 'Finish investigation', kind: 'other',
    })
    expect(ctx.tools.get('stop_unknown')?.presentCall?.({ reason: 'no trace' })).toEqual({
      card: 'generic', title: 'Stop investigation as unknown', kind: 'other', rawInput: 'no trace',
    })
  })
})

describe('run_physical_assessment', () => {
  it('fails without an active investigation and without an executing agent', async () => {
    const { ctx, root } = await harness()
    resultError(await execute(ctx, 'run_physical_assessment', {}, root.agent), /no investigation to run/)
    const started = await startedHarness()
    resultError(await execute(started.ctx, 'run_physical_assessment', {}), /require an executing agent/)
  })

  it('returns the typed provider result and commits the state update', async () => {
    const { ctx, root } = await startedHarness()
    const result = await execute(ctx, 'run_physical_assessment', {}, root.agent)
    expect(resultJson(result)).toEqual({
      physical: { handObservation: 'valid', traceQuality: 'reliable', hoiSupport: 'positive', objectTraceQuality: 'reliable' },
      lineage: 'attached',
      summary: 'Stub assessment of candidate C17: all physical dimensions resolved.',
      evidenceStatus: 'satisfied',
      revision: 2,
      attemptsUsed: 1,
      maxAttempts: 3,
    })
    expect(root.session.events.filter(event => event.type === 'investigation/change')).toHaveLength(2)
  })
})

describe('terminal macro-actions', () => {
  it('finish_investigation rejects unfinished evidence, then concludes the turn', async () => {
    const { ctx, root } = await startedHarness()
    resultError(await execute(ctx, 'finish_investigation', {}, root.agent), /must be assessed before finishing/)
    await execute(ctx, 'run_physical_assessment', {}, root.agent)
    const result = await execute(ctx, 'finish_investigation', {}, root.agent)
    expect(resultJson(result)).toEqual({ phase: 'finished', revision: 3, evidenceStatus: 'satisfied' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected finish success')
    expect(result.concludesTurn).toBe(true)
  })

  it('stop_unknown records the reason and concludes the turn', async () => {
    const { ctx, root } = await startedHarness()
    const result = await execute(ctx, 'stop_unknown', { reason: 'no usable trace in the window' }, root.agent)
    expect(resultJson(result)).toEqual({ phase: 'stopped-unknown', revision: 2, evidenceStatus: 'pending' })
    if (result.isError) throw new Error('expected stop_unknown success')
    expect(result.concludesTurn).toBe(true)
    const last = root.session.events[root.session.events.length - 1]
    if (last?.type !== 'investigation/change') throw new Error('expected durable stop-unknown')
    expect(last.data.reason).toBe('no usable trace in the window')
  })

  it('rejects a missing stop reason at the schema boundary', async () => {
    const { ctx, root } = await startedHarness()
    resultError(await execute(ctx, 'stop_unknown', {}, root.agent), /reason/)
  })

  it('denies every investigation tool once the phase is terminal', async () => {
    const { ctx, root } = await startedHarness()
    await execute(ctx, 'stop_unknown', { reason: 'done' }, root.agent)
    for (const name of ['run_physical_assessment', 'finish_investigation', 'stop_unknown']) {
      resultError(
        await execute(ctx, name, name === 'stop_unknown' ? { reason: 'again' } : {}, root.agent),
        /investigation is stopped-unknown/,
      )
    }
  })

  it('leaves other tools and agent-less guards untouched', async () => {
    const { ctx, root } = await startedHarness()
    ctx.tools.register(defineTool({
      name: 'unrelated_probe',
      description: 'probe',
      parameters: {},
      output: { schema: { type: 'null' }, render: () => [{ type: 'text' as const, text: 'null' }] },
      execute: () => Promise.resolve(null),
    }))
    const result = await execute(ctx, 'unrelated_probe', {}, root.agent)
    expect(result.isError).toBe(false)
  })
})

describe('authoritative state projection', () => {
  it('enters a source-attributed snapshot on revision changes only', async () => {
    const { ctx, root } = await startedHarness()
    const first = await preStep(ctx, root.agent)
    if (first.kind !== 'enter') throw new Error('expected an enter decision')
    expect(first.messages).toHaveLength(1)
    expect(first.messages[0]?.source).toMatchObject({ kind: 'plugin', plugin: 'tool-agentic-control', form: 'snapshot' })
    const firstText = first.messages[0]?.content[0]
    if (firstText?.type !== 'text') throw new Error('expected text projection')
    expect(firstText.text).toContain('revision 1')
    expect(firstText.text).toContain('phase active')
    expect(firstText.text).toContain('run_physical_assessment')

    const repeated = await preStep(ctx, root.agent)
    if (repeated.kind !== 'enter') throw new Error('expected an enter decision')
    expect(repeated.messages).toHaveLength(0)

    await execute(ctx, 'run_physical_assessment', {}, root.agent)
    const afterAssess = await preStep(ctx, root.agent)
    if (afterAssess.kind !== 'enter') throw new Error('expected an enter decision')
    expect(afterAssess.messages).toHaveLength(1)
    const resolvedText = afterAssess.messages[0]?.content[0]
    if (resolvedText?.type !== 'text') throw new Error('expected text projection')
    expect(resolvedText.text).toContain('revision 2')
    expect(resolvedText.text).toContain('finish_investigation')
  })

  it('projects nothing without an investigation and passes through rejections', async () => {
    const { ctx, root } = await harness()
    const decision = await preStep(ctx, root.agent)
    if (decision.kind !== 'enter') throw new Error('expected an enter decision')
    expect(decision.messages).toHaveLength(0)

    const rejected = await agentEvents(ctx, root.agent).waterfall(
      'agent/pre-step',
      { messages: [], turn: 1, step: 1, signal: testToolSignal },
      () => Promise.resolve({ kind: 'reject' as const }),
    )
    expect(rejected).toEqual({ kind: 'reject' })
  })

  it('keeps the proposed messages and renders terminal and empty-requirement states', async () => {
    const { ctx, root } = await harness()
    ctx.investigations.start(root.agent, { candidateId: 'C9', actionFamily: 'pour', window: 'w', requirements: [] })
    ctx.investigations.stopUnknown(root.agent, 'no channel')
    const proposed = createUserMessage({
      content: [{ type: 'text', text: 'request proposal' }],
      source: { kind: 'user' },
    })
    const decision = await preStep(ctx, root.agent, [proposed])
    if (decision.kind !== 'enter') throw new Error('expected an enter decision')
    expect(decision.messages[0]).toBe(proposed)
    expect(decision.messages).toHaveLength(2)
    const text = decision.messages[1]?.content[0]
    if (text?.type !== 'text') throw new Error('expected text projection')
    expect(text.text).toContain('phase stopped-unknown')
    expect(text.text).toContain('requirements (pending): none.')
    expect(text.text).not.toContain('call run_physical_assessment')
  })
})
