import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import InvestigationService, {
  decodeInvestigationChange,
  deriveEvidenceStatus,
  foldInvestigations,
} from '@deepseek-ai/dsh-agentic-control'
import type {
  InvestigationState,
  PhysicalAssessmentProvider,
  PhysicalState,
} from '@deepseek-ai/dsh-agentic-control'

interface StubAgent {
  agent: Agent
  session: Session
}

/** Build a registry-compatible agent around a fresh session. */
function stubAgent(rawId: string): StubAgent {
  const session = Session.create(SessionId(rawId))
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { inbox.append('next-step', input) },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, session }
}

async function harness(config: { maxAttempts?: number; provider?: string } = {}) {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(InvestigationService, config)
  const stub = stubAgent(`investigation-test-${Math.random()}`)
  ctx.agents.register(stub.agent)
  return { ctx, ...stub }
}

const START_REQUEST = {
  candidateId: 'C17',
  actionFamily: 'pick-place',
  window: 't=10..20',
  requirements: ['physical assessment'],
} as const

/** Start one investigation through the service. */
async function startWith(config: { maxAttempts?: number; provider?: string } = {}) {
  const scope = await harness(config)
  const state = scope.ctx.investigations.start(scope.agent, { ...START_REQUEST, requirements: [...START_REQUEST.requirements] })
  return { ...scope, state }
}

/** Fresh valid start-state record for decoder tests. */
function startState(): Record<string, unknown> {
  return {
    revision: 1,
    candidate: { id: 'C17', actionFamily: 'pick-place', window: 't=10..20' },
    evidence: { requirements: ['physical assessment'], currentStatus: 'pending' },
    physical: { handObservation: 'unknown', traceQuality: 'unknown', hoiSupport: 'unknown', objectTraceQuality: 'unknown' },
    lineage: 'unknown',
    attempts: [],
    budget: { maxAttempts: 3, usedAttempts: 0 },
    phase: 'active',
  }
}

/** Valid post-assessment state record at revision 2. */
function assessedState(): Record<string, unknown> {
  return {
    ...startState(),
    revision: 2,
    evidence: { requirements: ['physical assessment'], currentStatus: 'satisfied' },
    physical: { handObservation: 'valid', traceQuality: 'reliable', hoiSupport: 'positive', objectTraceQuality: 'reliable' },
    lineage: 'attached',
    attempts: [{
      action: 'run_physical_assessment',
      provider: 'stub',
      outcome: 'completed',
      provenance: 'stub',
      at: 2,
    }],
    budget: { maxAttempts: 3, usedAttempts: 1 },
  }
}

/** Wrap one state record in a change envelope. */
function changeFor(operation: string, state: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind: 'investigation/change', version: 1, operation, state, at: 3, ...extra }
}

describe('deriveEvidenceStatus', () => {
  it.each([
    ['pending', { handObservation: 'unknown', traceQuality: 'unknown', hoiSupport: 'unknown', objectTraceQuality: 'unknown' }],
    ['partial', { handObservation: 'valid', traceQuality: 'unknown', hoiSupport: 'unknown', objectTraceQuality: 'unknown' }],
    ['satisfied', { handObservation: 'valid', traceQuality: 'reliable', hoiSupport: 'positive', objectTraceQuality: 'absent' }],
  ] as const)('derives %s', (status, physical) => {
    expect(deriveEvidenceStatus(physical as PhysicalState)).toBe(status)
  })
})

describe('InvestigationService start and replay', () => {
  it('writes one durable start change and reads back an equal detached copy', async () => {
    const { ctx, agent, session, state } = await startWith({ maxAttempts: 7 })
    expect(state).toMatchObject({
      revision: 1,
      candidate: { id: 'C17', actionFamily: 'pick-place', window: 't=10..20' },
      evidence: { requirements: ['physical assessment'], currentStatus: 'pending' },
      physical: { handObservation: 'unknown' },
      lineage: 'unknown',
      attempts: [],
      budget: { maxAttempts: 7, usedAttempts: 0 },
      phase: 'active',
    })
    expect(session.events.map(event => event.type)).toEqual(['investigation/change'])
    const event = session.events[0]
    if (event?.type !== 'investigation/change') throw new Error('expected durable investigation change')
    expect(decodeInvestigationChange(event.data)).toMatchObject({ operation: 'start', state: { revision: 1 } })
    const view = ctx.investigations.get(agent)
    expect(view).toEqual(state)
    expect(view).not.toBe(state)
    expect(foldInvestigations(session.events)).toEqual(state)
  })

  it('returns undefined before any start and rejects a second start', async () => {
    const { ctx, agent } = await harness()
    expect(ctx.investigations.get(agent)).toBeUndefined()
    ctx.investigations.start(agent, { candidateId: '  C9  ', actionFamily: 'pour', window: 'w', requirements: [] })
    expect(ctx.investigations.get(agent)?.candidate.id).toBe('C9')
    expect(() => ctx.investigations.start(agent, { ...START_REQUEST, requirements: [] }))
      .toThrow(expect.objectContaining({ code: 'INVESTIGATION_EXISTS' }))
  })

  it('validates the start request inside start', async () => {
    const { ctx, agent } = await harness()
    const start = (request: Record<string, unknown>) => () =>
      ctx.investigations.start(agent, request as never)
    expect(start({ ...START_REQUEST, candidateId: '   ', requirements: [] }))
      .toThrow(expect.objectContaining({ code: 'INVESTIGATION_INVALID_REQUEST' }))
    expect(start({ ...START_REQUEST, requirements: ['ok', ' '] }))
      .toThrow(expect.objectContaining({ code: 'INVESTIGATION_INVALID_REQUEST' }))
    expect(start({ ...START_REQUEST, requirements: [], maxAttempts: 0 }))
      .toThrow(expect.objectContaining({ code: 'INVESTIGATION_INVALID_REQUEST' }))
  })

  it('rejects a blank provider id at load and an unregistered provider at the first assessment', async () => {
    const blank = new Context()
    await blank.plugin(AgentRegistry)
    await expect(blank.plugin(InvestigationService, { provider: '  ' }).then(() => undefined))
      .rejects.toThrow(expect.objectContaining({ code: 'INVESTIGATION_UNKNOWN_PROVIDER' }))

    const { ctx, agent } = await startWith({ provider: 'tower-adapter' })
    await expect(ctx.investigations.runPhysicalAssessment(agent))
      .rejects.toThrow(expect.objectContaining({ code: 'INVESTIGATION_UNKNOWN_PROVIDER' }))
  })

  it('rejects an invalid configured attempt cap at load', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    // Loader/plugin config validation rejects non-integers through the schema.
    await expect(ctx.plugin(InvestigationService, { maxAttempts: 1.5 }).then(() => undefined))
      .rejects.toThrow(/maxAttempts/)
    // Direct construction (no schema normalization) is validated by the service itself.
    expect(() => new InvestigationService(new Context(), { maxAttempts: 1.5 }))
      .toThrow(expect.objectContaining({ code: 'INVESTIGATION_INVALID_REQUEST' }))
  })

  it('rejects reads through a non-live agent identity', async () => {
    const { ctx } = await startWith()
    const stranger = stubAgent(`investigation-stranger-${Math.random()}`)
    expect(() => ctx.investigations.get(stranger.agent))
      .toThrow(expect.objectContaining({ code: 'INVESTIGATION_AGENT_NOT_LIVE' }))
  })

  it('applies deployment defaults when constructed directly without config', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const service = new InvestigationService(ctx)
    const stub = stubAgent(`investigation-direct-${Math.random()}`)
    ctx.agents.register(stub.agent)
    const state = service.start(stub.agent, { ...START_REQUEST, requirements: [...START_REQUEST.requirements] })
    expect(state.budget.maxAttempts).toBe(3)
    const { state: assessed } = await service.runPhysicalAssessment(stub.agent)
    expect(assessed.attempts[0]?.provider).toBe('stub')
  })

  it('folds pre-existing log events when the cache is first seeded', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(InvestigationService)
    const stub = stubAgent(`investigation-seeded-${Math.random()}`)
    ctx.agents.register(stub.agent)
    stub.session.append('investigation/change', changeFor('start', startState()) as never)
    expect(ctx.investigations.get(stub.agent)).toMatchObject({ revision: 1, phase: 'active' })
  })
})

describe('InvestigationService.runPhysicalAssessment', () => {
  it('commits a stub assessment with provider-authored lineage and derived evidence', async () => {
    const { ctx, agent, session } = await startWith()
    const { state, result } = await ctx.investigations.runPhysicalAssessment(agent)
    expect(result.lineage).toBe('attached')
    expect(result.summary).toContain('C17')
    expect(state).toMatchObject({
      revision: 2,
      physical: { handObservation: 'valid', traceQuality: 'reliable', hoiSupport: 'positive', objectTraceQuality: 'reliable' },
      lineage: 'attached',
      evidence: { currentStatus: 'satisfied' },
      budget: { usedAttempts: 1, maxAttempts: 3 },
      phase: 'active',
    })
    expect(state.attempts).toHaveLength(1)
    expect(state.attempts[0]).toMatchObject({
      action: 'run_physical_assessment',
      provider: 'stub',
      outcome: 'completed',
      provenance: 'stub',
    })
    expect(session.events.map(event => event.type)).toEqual(['investigation/change', 'investigation/change'])
    const last = session.events[1]
    if (last?.type !== 'investigation/change') throw new Error('expected durable assessment change')
    expect(decodeInvestigationChange(last.data)?.operation).toBe('assess')
    expect(foldInvestigations(session.events)).toEqual(state)
  })

  it('rejects assessments without, after, or beyond the investigation', async () => {
    const empty = await harness()
    await expect(empty.ctx.investigations.runPhysicalAssessment(empty.agent))
      .rejects.toThrow(expect.objectContaining({ code: 'INVESTIGATION_NOT_FOUND' }))

    const { ctx, agent } = await startWith({ maxAttempts: 1 })
    await ctx.investigations.runPhysicalAssessment(agent)
    await expect(ctx.investigations.runPhysicalAssessment(agent))
      .rejects.toThrow(expect.objectContaining({ code: 'INVESTIGATION_BUDGET_EXHAUSTED' }))

    const closed = await startWith()
    await closed.ctx.investigations.runPhysicalAssessment(closed.agent)
    closed.ctx.investigations.finish(closed.agent)
    await expect(closed.ctx.investigations.runPhysicalAssessment(closed.agent))
      .rejects.toThrow(expect.objectContaining({ code: 'INVESTIGATION_CLOSED' }))
  })

  it('commits a budget-consuming failed attempt when the provider throws', async () => {
    const { ctx, agent, session } = await startWith({ provider: 'failing' })
    ctx.investigations.registerProvider({
      id: 'failing',
      provenance: 'stub',
      assess: () => { throw new Error('backend down') },
    })
    await expect(ctx.investigations.runPhysicalAssessment(agent)).rejects.toThrow('backend down')
    const state = ctx.investigations.get(agent)
    expect(state).toMatchObject({
      revision: 2,
      phase: 'active',
      lineage: 'unknown',
      evidence: { currentStatus: 'pending' },
      budget: { usedAttempts: 1 },
    })
    expect(state?.attempts[0]).toMatchObject({ outcome: 'failed', provider: 'failing', reason: 'backend down' })
    const last = session.events[1]
    if (last?.type !== 'investigation/change') throw new Error('expected durable failed attempt')
    const change = decodeInvestigationChange(last.data)
    expect(change).toMatchObject({ operation: 'assess-failed', reason: 'backend down' })
  })

  it('stringifies a non-Error provider throw into the attempt reason', async () => {
    const { ctx, agent } = await startWith({ provider: 'failing' })
    ctx.investigations.registerProvider({
      id: 'failing',
      provenance: 'stub',
      assess: () => { throw 'string-failure' },
    })
    await expect(ctx.investigations.runPhysicalAssessment(agent)).rejects.toBe('string-failure')
    expect(ctx.investigations.get(agent)?.attempts[0]?.reason).toBe('string-failure')
  })

  it('rejects a malformed provider result without consuming budget or appending', async () => {
    const { ctx, agent, session } = await startWith({ provider: 'garbage' })
    ctx.investigations.registerProvider({
      id: 'garbage',
      provenance: 'stub',
      assess: () => ({
        physical: { handObservation: 'bogus', traceQuality: 'reliable', hoiSupport: 'positive', objectTraceQuality: 'reliable' },
        summary: 'invalid dimensions',
      }) as never,
    })
    await expect(ctx.investigations.runPhysicalAssessment(agent))
      .rejects.toThrow(expect.objectContaining({ code: 'INVESTIGATION_INVALID_RESULT' }))
    expect(session.events).toHaveLength(1)
    expect(ctx.investigations.get(agent)?.budget.usedAttempts).toBe(0)
  })

  it.each<[string, unknown]>([
    ['summary', { physical: { handObservation: 'valid', traceQuality: 'reliable', hoiSupport: 'positive', objectTraceQuality: 'reliable' }, summary: '  ' }],
    ['lineage', { physical: { handObservation: 'valid', traceQuality: 'reliable', hoiSupport: 'positive', objectTraceQuality: 'reliable' }, summary: 'ok', lineage: 'maybe' }],
  ])('rejects a malformed provider result with a bad %s field', async (_field, result) => {
    const { ctx, agent } = await startWith({ provider: 'garbage' })
    ctx.investigations.registerProvider({ id: 'garbage', provenance: 'stub', assess: () => result as never })
    await expect(ctx.investigations.runPhysicalAssessment(agent))
      .rejects.toThrow(expect.objectContaining({ code: 'INVESTIGATION_INVALID_RESULT' }))
  })

  it('keeps lineage when the provider omits a verdict and derives partial evidence', async () => {
    const partial: PhysicalAssessmentProvider = {
      id: 'partial',
      provenance: 'stub',
      assess: () => ({
        physical: { handObservation: 'valid', traceQuality: 'unknown', hoiSupport: 'unknown', objectTraceQuality: 'unknown' },
        summary: 'only the hand observation resolved',
      }),
    }
    const { ctx, agent } = await startWith({ provider: 'partial' })
    ctx.investigations.registerProvider(partial)
    const { state } = await ctx.investigations.runPhysicalAssessment(agent)
    expect(state.lineage).toBe('unknown')
    expect(state.evidence.currentStatus).toBe('partial')
  })

  it('registers providers as effects with unique ids', async () => {
    const { ctx, agent } = await startWith({ provider: 'extra' })
    expect(() => ctx.investigations.registerProvider({ id: 'stub', provenance: 'stub', assess: () => { throw new Error('unused') } }))
      .toThrow(expect.objectContaining({ code: 'INVESTIGATION_INVALID_REQUEST' }))
    const dispose = ctx.investigations.registerProvider({
      id: 'extra',
      provenance: 'stub',
      assess: state => ({
        physical: { handObservation: 'invalid', traceQuality: 'absent', hoiSupport: 'negative', objectTraceQuality: 'degraded' },
        lineage: 'rejected',
        summary: `rejected ${state.candidate.id}`,
      }),
    })
    const { state } = await ctx.investigations.runPhysicalAssessment(agent)
    expect(state.lineage).toBe('rejected')
    dispose()
    await expect(ctx.investigations.runPhysicalAssessment(agent))
      .rejects.toThrow(expect.objectContaining({ code: 'INVESTIGATION_UNKNOWN_PROVIDER' }))
  })
})

describe('InvestigationService terminal transitions', () => {
  it('finishes only with satisfied evidence', async () => {
    const { ctx, agent, session } = await startWith()
    expect(() => ctx.investigations.finish(agent))
      .toThrow(expect.objectContaining({ code: 'INVESTIGATION_NOT_FINISHABLE' }))
    await ctx.investigations.runPhysicalAssessment(agent)
    const state = ctx.investigations.finish(agent)
    expect(state).toMatchObject({ revision: 3, phase: 'finished', evidence: { currentStatus: 'satisfied' } })
    const last = session.events[2]
    if (last?.type !== 'investigation/change') throw new Error('expected durable finish')
    expect(decodeInvestigationChange(last.data)?.operation).toBe('finish')
    expect(() => ctx.investigations.finish(agent))
      .toThrow(expect.objectContaining({ code: 'INVESTIGATION_CLOSED' }))
  })

  it('rejects finish without a current investigation', async () => {
    const { ctx, agent } = await harness()
    expect(() => ctx.investigations.finish(agent))
      .toThrow(expect.objectContaining({ code: 'INVESTIGATION_NOT_FOUND' }))
    expect(() => ctx.investigations.stopUnknown(agent, 'no evidence channel'))
      .toThrow(expect.objectContaining({ code: 'INVESTIGATION_NOT_FOUND' }))
  })

  it('stops as unknown with a durable normalized reason', async () => {
    const { ctx, agent, session } = await startWith()
    expect(() => ctx.investigations.stopUnknown(agent, '  '))
      .toThrow(expect.objectContaining({ code: 'INVESTIGATION_INVALID_REQUEST' }))
    const state = ctx.investigations.stopUnknown(agent, '  no usable trace  ')
    expect(state).toMatchObject({ revision: 2, phase: 'stopped-unknown' })
    const last = session.events[1]
    if (last?.type !== 'investigation/change') throw new Error('expected durable stop-unknown')
    expect(decodeInvestigationChange(last.data)).toMatchObject({ operation: 'stop-unknown', reason: 'no usable trace' })
    expect(() => ctx.investigations.stopUnknown(agent, 'again'))
      .toThrow(expect.objectContaining({ code: 'INVESTIGATION_CLOSED' }))
  })
})

describe('decodeInvestigationChange', () => {
  it('returns undefined for unrelated values', () => {
    expect(decodeInvestigationChange(42)).toBeUndefined()
    expect(decodeInvestigationChange({ kind: 'goal/change' })).toBeUndefined()
  })

  it.each([
    ['version', changeFor('assess', assessedState(), { version: 2 }), /unsupported investigation change version/],
    ['non-string operation', changeFor('assess', assessedState(), { operation: 7 }), /operation is invalid/],
    ['unknown operation', changeFor('explode', assessedState()), /operation is invalid/],
    ['missing envelope key', (() => { const c = changeFor('assess', assessedState()); delete c['state']; return c })(), /must have exactly/],
    ['extra envelope key', changeFor('assess', assessedState(), { extra: 1 }), /must have exactly/],
    ['stop-unknown without reason', changeFor('stop-unknown', { ...assessedState(), revision: 3, phase: 'stopped-unknown' }), /requires a reason/],
    ['blank reason', changeFor('assess-failed', assessedState(), { reason: ' ' }), /reason must be a non-empty/],
    ['negative timestamp', changeFor('assess', assessedState(), { at: -1 }), /at must be a non-negative/],
  ])('rejects a change with an invalid %s', (_label, change, message) => {
    expect(() => decodeInvestigationChange(change)).toThrow(message)
  })

  it.each([
    ['non-record state', { state: 42 }, /state must be a record/],
    ['state keys', { state: { revision: 1 } }, /state must have exactly/],
    ['revision', { state: { ...startState(), revision: 0 } }, /state\.revision must be a positive/],
    ['candidate record', { state: { ...startState(), candidate: 7 } }, /state\.candidate must be a record/],
    ['candidate keys', { state: { ...startState(), candidate: { id: 'C17' } } }, /state\.candidate must have exactly/],
    ['candidate id', { state: { ...startState(), candidate: { id: ' x ', actionFamily: 'a', window: 'w' } } }, /state\.candidate\.id must be a non-empty/],
    ['evidence record', { state: { ...startState(), evidence: null } }, /state\.evidence must be a record/],
    ['evidence keys', { state: { ...startState(), evidence: { currentStatus: 'pending' } } }, /state\.evidence must have exactly/],
    ['requirements array', { state: { ...startState(), evidence: { currentStatus: 'pending', requirements: 'r' } } }, /requirements must be an array/],
    ['requirement entry', { state: { ...startState(), evidence: { currentStatus: 'pending', requirements: [9] } } }, /requirements entry must be a non-empty/],
    ['physical record', { state: { ...startState(), physical: [] } }, /state\.physical must be a record/],
    ['physical keys', { state: { ...startState(), physical: { handObservation: 'unknown' } } }, /state\.physical must have exactly/],
    ['physical dimension', { state: { ...startState(), physical: { handObservation: 'fuzzy', traceQuality: 'unknown', hoiSupport: 'unknown', objectTraceQuality: 'unknown' } } }, /state\.physical\.handObservation is invalid/],
    ['evidence status enum', { state: { ...startState(), evidence: { currentStatus: 'done', requirements: [] } } }, /state\.evidence\.currentStatus is invalid/],
    ['evidence status contradiction', { state: { ...startState(), evidence: { currentStatus: 'satisfied', requirements: [] } } }, /contradicts state\.physical/],
    ['budget record', { state: { ...startState(), budget: 3 } }, /state\.budget must be a record/],
    ['budget keys', { state: { ...startState(), budget: { maxAttempts: 3 } } }, /state\.budget must have exactly/],
    ['maxAttempts', { state: { ...startState(), budget: { maxAttempts: 0, usedAttempts: 0 } } }, /state\.budget\.maxAttempts must be a positive/],
    ['usedAttempts', { state: { ...startState(), budget: { maxAttempts: 3, usedAttempts: -1 } } }, /state\.budget\.usedAttempts must be a non-negative/],
    ['usedAttempts overflow', { state: { ...startState(), budget: { maxAttempts: 3, usedAttempts: 4 }, attempts: [] } }, /exceeds maxAttempts/],
    ['attempt count mismatch', { state: { ...startState(), budget: { maxAttempts: 3, usedAttempts: 1 }, attempts: [] } }, /must equal the attempt count/],
    ['attempts array', { state: { ...startState(), attempts: {} } }, /state\.attempts must be an array/],
    ['lineage', { state: { ...startState(), lineage: 'attached-ish' } }, /state\.lineage is invalid/],
    ['phase', { state: { ...startState(), phase: 'running' } }, /state\.phase is invalid/],
  ])('rejects a state with an invalid %s', (_label, change, message) => {
    expect(() => decodeInvestigationChange(changeFor('start', (change as { state: unknown }).state as Record<string, unknown>)))
      .toThrow(message)
  })

  it.each([
    ['non-record attempt', [42], /attempts entries must be records/],
    ['attempt keys', [{}], /attempts entry must have exactly/],
    ['attempt action', [{ action: 'poke', provider: 'stub', outcome: 'completed', provenance: 'stub', at: 1 }], /action is invalid/],
    ['attempt outcome', [{ action: 'run_physical_assessment', provider: 'stub', outcome: 'ok', provenance: 'stub', at: 1 }], /outcome is invalid/],
    ['attempt provenance', [{ action: 'run_physical_assessment', provider: 'stub', outcome: 'completed', provenance: 'tower', at: 1 }], /provenance is invalid/],
    ['attempt provider', [{ action: 'run_physical_assessment', provider: '', outcome: 'completed', provenance: 'stub', at: 1 }], /provider must be a non-empty/],
    ['attempt timestamp', [{ action: 'run_physical_assessment', provider: 'stub', outcome: 'completed', provenance: 'stub', at: -1 }], /at must be a non-negative/],
    ['reason on success', [{ action: 'run_physical_assessment', provider: 'stub', outcome: 'completed', provenance: 'stub', at: 1, reason: 'why' }], /reason requires a failed outcome/],
    ['blank attempt reason', [{ action: 'run_physical_assessment', provider: 'stub', outcome: 'failed', provenance: 'stub', at: 1, reason: '' }], /reason must be a non-empty/],
  ])('rejects %s', (_label, attempts, message) => {
    const state = { ...assessedState(), attempts, budget: { maxAttempts: 3, usedAttempts: attempts.length } }
    expect(() => decodeInvestigationChange(changeFor('assess', state))).toThrow(message)
  })
})

describe('applyInvestigationChange replay strictness', () => {
  /** Fold raw changes through events. */
  function fold(...changes: Record<string, unknown>[]): InvestigationState | undefined {
    const events = changes.map((data, seq) => ({ type: 'investigation/change', seq, time: seq, data }) as SessionEvent)
    return foldInvestigations(events)
  }

  it('accepts a full start-assess-finish trajectory', () => {
    const state = fold(
      changeFor('start', startState()),
      changeFor('assess', assessedState()),
      changeFor('finish', { ...assessedState(), revision: 3, phase: 'finished' }),
    )
    expect(state).toMatchObject({ revision: 3, phase: 'finished', lineage: 'attached' })
  })

  it.each([
    ['a second start', [changeFor('start', startState()), changeFor('start', startState())], /start requires no existing/],
    ['a non-fresh start', [changeFor('start', { ...startState(), revision: 2 })], /fresh active revision-one/],
    ['an assess without a start', [changeFor('assess', assessedState())], /assess requires a current/],
    ['a stalled revision', [changeFor('start', startState()), changeFor('assess', { ...assessedState(), revision: 1 })], /advance the revision by one/],
    ['a terminal assess', [changeFor('start', startState()), changeFor('assess', { ...assessedState(), phase: 'finished' })], /keeps the phase active/],
    ['an assess without a new attempt', [changeFor('start', startState()), changeFor('assess', { ...assessedState(), attempts: [], budget: { maxAttempts: 3, usedAttempts: 0 } })], /appends exactly one attempt/],
    ['an assess with a failed attempt', [changeFor('start', startState()), changeFor('assess', {
      ...assessedState(),
      attempts: [{ action: 'run_physical_assessment', provider: 'stub', outcome: 'failed', provenance: 'stub', at: 1, reason: 'x' }],
    })], /requires a completed attempt/],
    ['an assess-failed with a completed attempt', [changeFor('start', startState()), changeFor('assess-failed', assessedState(), { reason: 'x' })], /requires a failed attempt/],
    ['a finish without satisfied evidence', [changeFor('start', startState()), changeFor('finish', { ...startState(), revision: 2, phase: 'finished' })], /finished phase with satisfied evidence/],
    ['a stop-unknown with a wrong phase', [changeFor('start', startState()), changeFor('stop-unknown', { ...startState(), revision: 2, phase: 'finished' }, { reason: 'x' })], /requires the stopped-unknown phase/],
    ['a mutation after finish', [
      changeFor('start', startState()),
      changeFor('assess', assessedState()),
      changeFor('finish', { ...assessedState(), revision: 3, phase: 'finished' }),
      changeFor('stop-unknown', { ...assessedState(), revision: 4, phase: 'stopped-unknown' }, { reason: 'x' }),
    ], /follows a terminal phase/],
  ])('rejects %s', (_label, changes, message) => {
    expect(() => fold(...changes)).toThrow(message)
  })

  it('ignores unrelated session events', () => {
    expect(foldInvestigations([])).toBeUndefined()
    const events = [
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
      { type: 'investigation/change', seq: 1, time: 1, data: changeFor('start', startState()) },
    ] as SessionEvent[]
    expect(foldInvestigations(events)).toMatchObject({ revision: 1 })
  })
})
