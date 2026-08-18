import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { type SessionEvent } from '@deepseek-ai/dsh-session'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as AgenticInvariant from '@deepseek-ai/dsh-agentic-control/invariant'

function startChange(): Record<string, unknown> {
  return {
    kind: 'investigation/change',
    version: 1,
    operation: 'start',
    state: {
      revision: 1,
      candidate: { id: 'C17', actionFamily: 'pick-place', window: 't=10..20' },
      evidence: { requirements: ['physical assessment'], currentStatus: 'pending' },
      physical: { handObservation: 'unknown', traceQuality: 'unknown', hoiSupport: 'unknown', objectTraceQuality: 'unknown' },
      lineage: 'unknown',
      attempts: [],
      budget: { maxAttempts: 3, usedAttempts: 0 },
      phase: 'active',
    },
    at: 1,
  }
}

function assessChange(): Record<string, unknown> {
  const start = startChange()
  return {
    ...start,
    operation: 'assess',
    state: {
      ...(start['state'] as Record<string, unknown>),
      revision: 2,
      evidence: { requirements: ['physical assessment'], currentStatus: 'satisfied' },
      physical: { handObservation: 'valid', traceQuality: 'reliable', hoiSupport: 'positive', objectTraceQuality: 'reliable' },
      lineage: 'attached',
      attempts: [{ action: 'run_physical_assessment', provider: 'stub', outcome: 'completed', provenance: 'stub', at: 2 }],
      budget: { maxAttempts: 3, usedAttempts: 1 },
    },
    at: 3,
  }
}

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(AgenticInvariant)
  return ctx
}

describe('investigation change invariants', () => {
  it('accepts a valid appended trajectory and ignores unrelated dispatches', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    expect(() => {
      session.append('investigation/change', startChange() as never)
      session.append('investigation/change', assessChange() as never)
      ctx.emit('tools/change')
      ctx.emit('session/event', session, { type: 'turn/start', seq: 2, time: 2, data: { turn: 1 } } as SessionEvent)
    }).not.toThrow()
  })

  it('rejects a live change that stalls the revision', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    session.append('investigation/change', startChange() as never)
    expect(() => session.append('investigation/change', {
      ...assessChange(),
      state: { ...(assessChange()['state'] as Record<string, unknown>), revision: 1 },
    } as never)).toThrow(/advance the revision by one/)
  })

  it('validates a change delivered outside the log against the tracked fold', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    session.append('investigation/change', startChange() as never)
    // The event never entered session.events, so the companion applies it itself.
    expect(() => {
      ctx.emit('session/event', session, {
        type: 'investigation/change', seq: 1, time: 1, data: assessChange(),
      } as SessionEvent)
    }).not.toThrow()
    expect(() => {
      ctx.emit('session/event', session, {
        type: 'investigation/change', seq: 2, time: 2, data: startChange(),
      } as SessionEvent)
    }).toThrow(/start requires no existing/)
    // A re-delivered event whose sequence predates the tracked fold is skipped.
    expect(() => {
      ctx.emit('session/event', session, {
        type: 'investigation/change', seq: 0, time: 0, data: startChange(),
      } as SessionEvent)
    }).not.toThrow()
  })

  it('accepts valid existing history on late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.sessions.create().append('investigation/change', startChange() as never)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(AgenticInvariant).then(() => undefined)).resolves.toBeUndefined()
  })

  it('rejects invalid existing history on late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.sessions.create().append('investigation/change', {
      ...startChange(),
      state: { ...(startChange()['state'] as Record<string, unknown>), lineage: 'attached' },
    } as never)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(AgenticInvariant).then(() => undefined))
      .rejects.toThrow(/fresh active revision-one/)
  })
})
