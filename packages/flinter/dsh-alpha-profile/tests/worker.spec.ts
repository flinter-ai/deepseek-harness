import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { AgentHandle, CreateAgentOptions, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import {
  assertWorkerResumeCompatible,
  bindWorkerSession,
  resumeWorkerAgent,
  startWorkerAgent,
  type DshWorkerLaunchContract,
  type WorkerAgentRegistry,
} from '../src/worker.ts'

const firstLaunch: DshWorkerLaunchContract = {
  dshSessionId: 's_org_job',
  dshSessionRoot: '/home/orca/.dsh/sessions/org/s_org_job',
  leaseOwner: 'worker-a',
  leaseGeneration: 4,
  workerAttemptCount: 0,
}

const handle = { agent: undefined, dispose: async () => undefined } as unknown as AgentHandle

function recordingRegistry() {
  const calls: { create?: CreateAgentOptions; resume?: ResumeAgentOptions } = {}
  const agents: WorkerAgentRegistry = {
    async create(options) {
      calls.create = options
      return handle
    },
    async resume(options) {
      calls.resume = options
      return handle
    },
  }
  return { agents, calls }
}

describe('alpha worker/session adapter', () => {
  it('binds the control-plane session ID and persistence root for a fresh Agent', async () => {
    const { agents, calls } = recordingRegistry()
    const binding = bindWorkerSession(firstLaunch, firstLaunch.dshSessionRoot)

    await startWorkerAgent(agents, binding, {
      cwd: '/workspace/flinter',
      selection: { provider: 'modelflare', model: 'gpt-5.6-sol', reasoningEffort: ReasoningEffortId('low') },
    })

    expect(binding.sessionId).toBe(firstLaunch.dshSessionId)
    expect(binding.persistenceRoot).toBe(firstLaunch.dshSessionRoot)
    expect(calls.create).toMatchObject({
      sessionId: firstLaunch.dshSessionId,
      meta: { cwd: '/workspace/flinter' },
      agentOptions: { provider: 'modelflare', model: 'gpt-5.6-sol', reasoningEffort: ReasoningEffortId('low') },
    })
    expect(calls.create?.setup).toEqual(expect.any(Function))
  })

  it('resumes the same DSH session while changing only lease/attempt identity', async () => {
    const { agents, calls } = recordingRegistry()
    const replacement: DshWorkerLaunchContract = {
      ...firstLaunch,
      leaseOwner: 'worker-b',
      leaseGeneration: 5,
      workerAttemptCount: 1,
    }

    await resumeWorkerAgent(agents, firstLaunch, replacement, firstLaunch.dshSessionRoot, {
      cwd: '/workspace/flinter',
      selection: { provider: 'ark-agent-plan', model: 'ark-code-latest', reasoningEffort: ReasoningEffortId('high') },
    })

    expect(calls.resume).toMatchObject({
      resumeSessionId: firstLaunch.dshSessionId,
      agentOptions: { provider: 'ark-agent-plan', model: 'ark-code-latest', reasoningEffort: ReasoningEffortId('high') },
    })
  })

  it('installs the native model-selection seam in the unpublished setup scope', async () => {
    const { agents, calls } = recordingRegistry()
    const binding = bindWorkerSession(firstLaunch, firstLaunch.dshSessionRoot)
    await startWorkerAgent(agents, binding, {
      cwd: '/workspace/flinter',
      selection: { provider: 'ark-agent-plan', model: 'ark-code-latest', reasoningEffort: ReasoningEffortId('xhigh') },
    })

    const setup = calls.create?.setup
    expect(setup).toEqual(expect.any(Function))
    await setup?.(new Context())
  })

  it.each([
    ['session id', { dshSessionId: 'other' }, /same dshSessionId/],
    ['session root', { dshSessionRoot: '/home/orca/.dsh/sessions/org/other' }, /same dshSessionRoot/],
    ['lease generation', { leaseGeneration: 4, workerAttemptCount: 1 }, /leaseGeneration must strictly increase/],
    ['worker attempt', { leaseGeneration: 5, workerAttemptCount: 0 }, /workerAttemptCount must strictly increase/],
  ])('rejects an unsafe resume: %s', (_label, change, message) => {
    expect(() => assertWorkerResumeCompatible(firstLaunch, { ...firstLaunch, ...change }))
      .toThrow(message)
  })

  it('rejects a persistence root that would split the DSH session from the lease root', () => {
    expect(() => bindWorkerSession(firstLaunch, '/tmp/other-root'))
      .toThrow('persistenceRoot must equal dshSessionRoot')
  })
})
