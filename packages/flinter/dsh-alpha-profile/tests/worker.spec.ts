import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { AgentHandle, CreateAgentOptions, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import {
  assertWorkerResumeCompatible,
  bindWorkerSession,
  buildWorkerPersistenceConfig,
  launchWorkerAgentFromEnvironment,
  readDshWorkerEnvironment,
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

function environmentFor(launch: DshWorkerLaunchContract = firstLaunch): NodeJS.ProcessEnv {
  return {
    DSH_SESSION_ID: launch.dshSessionId,
    DSH_SESSION_ROOT: launch.dshSessionRoot,
    DSH_LEASE_OWNER: launch.leaseOwner,
    DSH_LEASE_GENERATION: String(launch.leaseGeneration),
    DSH_COMPUTE_TIER: 'cpu',
    DSH_WORKER_ATTEMPT_COUNT: String(launch.workerAttemptCount),
    DSH_CALLBACK_URL: 'https://control.example.test/webhooks/dsh-worker/lifecycle',
    DSH_CALLBACK_HMAC_SECRET_REF: 'flinter/dsh-callback-hmac',
    DSH_IMAGE_DIGEST: 'sha256:abc123',
  }
}

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

  it('reads all nine launcher fields and produces a JSONL composition row', () => {
    const environment = readDshWorkerEnvironment(environmentFor())
    expect(environment).toMatchObject({
      launch: firstLaunch,
      computeTier: 'cpu',
      callbackUrl: 'https://control.example.test/webhooks/dsh-worker/lifecycle',
      callbackHmacSecretRef: 'flinter/dsh-callback-hmac',
      imageDigest: 'sha256:abc123',
    })
    expect(buildWorkerPersistenceConfig(firstLaunch.dshSessionRoot)).toEqual({
      name: '@deepseek-ai/dsh-session-persistence-jsonl',
      config: { root: firstLaunch.dshSessionRoot, compression: 'zstd' },
    })
  })

  it('uses create only for attempt zero when launched from the environment', async () => {
    const { agents, calls } = recordingRegistry()
    const result = await launchWorkerAgentFromEnvironment(agents, {
      cwd: '/workspace/flinter',
      selection: { provider: 'modelflare', model: 'gpt-5.6-sol' },
    }, environmentFor())
    expect(result.environment.launch.workerAttemptCount).toBe(0)
    expect(result.persistence.config.root).toBe(firstLaunch.dshSessionRoot)
    expect(calls.create?.sessionId).toBe(firstLaunch.dshSessionId)
    expect(calls.resume).toBeUndefined()
  })

  it('uses resume only for a replacement attempt and preserves the validated descriptor', async () => {
    const { agents, calls } = recordingRegistry()
    const replacement = { ...firstLaunch, leaseOwner: 'worker-b', leaseGeneration: 5, workerAttemptCount: 1 }
    const result = await launchWorkerAgentFromEnvironment(
      agents,
      { cwd: '/workspace/flinter', selection: { provider: 'ark-agent-plan', model: 'ark-code-latest' } },
      environmentFor(replacement),
      firstLaunch,
    )
    expect(result.environment.launch).toEqual(replacement)
    expect(calls.resume?.resumeSessionId).toBe(firstLaunch.dshSessionId)
    expect(calls.create).toBeUndefined()
  })

  it('fails closed when a replacement session is missing instead of creating a new one', async () => {
    const calls: { create: number; resume: number } = { create: 0, resume: 0 }
    const agents: WorkerAgentRegistry = {
      async create() { calls.create += 1; return handle },
      async resume() {
        calls.resume += 1
        throw new Error(`session "${firstLaunch.dshSessionId}" not found`)
      },
    }
    const replacement = { ...firstLaunch, leaseOwner: 'worker-b', leaseGeneration: 5, workerAttemptCount: 1 }
    await expect(launchWorkerAgentFromEnvironment(
      agents,
      { cwd: '/workspace/flinter', selection: { provider: 'gmi-serving', model: 'deepseek-ai/DeepSeek-V4-Flash-0731' } },
      environmentFor(replacement),
      firstLaunch,
    )).rejects.toThrow('not found')
    expect(calls).toEqual({ create: 0, resume: 1 })
  })

  it('rejects callback URLs that embed credentials', () => {
    expect(() => readDshWorkerEnvironment({
      DSH_SESSION_ID: 'session-1',
      DSH_SESSION_ROOT: '/tmp/dsh/session-1',
      DSH_LEASE_OWNER: 'worker-a',
      DSH_LEASE_GENERATION: '1',
      DSH_COMPUTE_TIER: 'cpu',
      DSH_WORKER_ATTEMPT_COUNT: '0',
      DSH_CALLBACK_URL: 'https://user:secret@control.example.test/callback',
      DSH_CALLBACK_HMAC_SECRET_REF: 'flinter/callback-hmac',
      DSH_IMAGE_DIGEST: 'sha256:abc',
    })).toThrow(/must not contain credentials/)
  })
})
