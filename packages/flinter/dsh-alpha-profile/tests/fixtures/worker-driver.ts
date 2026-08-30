/** Process fixture for the alpha control-plane worker driver. */

import {
  launchWorkerAgentFromEnvironment,
  type DshWorkerLaunchContract,
  type WorkerAgentRegistry,
} from '../../src/worker.ts'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'

const mode = process.argv[2] ?? 'fresh'
const handle = { agent: undefined, dispose: async () => undefined } as unknown as AgentHandle
const calls: string[] = []

const agents: WorkerAgentRegistry = {
  async create(options) {
    calls.push(`create:${String(options.sessionId)}`)
    return handle
  },
  async resume(options) {
    calls.push(`resume:${String(options.resumeSessionId)}`)
    if (mode === 'missing') throw new Error(`session "${String(options.resumeSessionId)}" not found`)
    return handle
  },
}

function previousLaunch(): DshWorkerLaunchContract {
  return {
    dshSessionId: process.env.DSH_SESSION_ID ?? '',
    dshSessionRoot: process.env.DSH_SESSION_ROOT ?? '',
    leaseOwner: 'worker-a',
    leaseGeneration: Number(process.env.DSH_LEASE_GENERATION ?? 0) - 1,
    workerAttemptCount: Number(process.env.DSH_WORKER_ATTEMPT_COUNT ?? 0) - 1,
  }
}

try {
  const result = await launchWorkerAgentFromEnvironment(
    agents,
    { cwd: '/workspace/flinter', selection: { provider: 'gmi-serving', model: 'deepseek-ai/DeepSeek-V4-Flash-0731' } },
    process.env,
    Number(process.env.DSH_WORKER_ATTEMPT_COUNT) === 0 ? undefined : previousLaunch(),
  )
  process.stdout.write(JSON.stringify({
    action: calls[0],
    persistence: result.persistence,
    computeTier: result.environment.computeTier,
  }) + '\n')
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
