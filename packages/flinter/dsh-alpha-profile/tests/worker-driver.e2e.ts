import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dirname, '../../../..')
const FIXTURE = join(import.meta.dirname, 'fixtures/worker-driver.ts')

function workerEnvironment(attempt: number): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    NODE_NO_WARNINGS: '1',
    DSH_SESSION_ID: 's_process',
    DSH_SESSION_ROOT: '/home/orca/.dsh/sessions/org/s_process',
    DSH_LEASE_OWNER: attempt === 0 ? 'worker-a' : 'worker-b',
    DSH_LEASE_GENERATION: String(attempt === 0 ? 4 : 5),
    DSH_COMPUTE_TIER: 'cpu',
    DSH_WORKER_ATTEMPT_COUNT: String(attempt),
    DSH_CALLBACK_URL: 'https://control.example.test/webhooks/dsh-worker/lifecycle',
    DSH_CALLBACK_HMAC_SECRET_REF: 'flinter/dsh-callback-hmac',
    DSH_IMAGE_DIGEST: 'sha256:process',
  }
}

async function run(mode: string, attempt: number) {
  return execa(process.execPath, ['--import', 'tsx/esm', FIXTURE, mode], {
    cwd: REPO_ROOT,
    env: workerEnvironment(attempt),
    extendEnv: false,
    reject: false,
    timeout: 15_000,
  })
}

describe('alpha worker driver process contract', () => {
  it('selects create and emits the stamped JSONL root for the first attempt', async () => {
    const result = await run('fresh', 0)
    expect(result.exitCode, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      action: 'create:s_process',
      persistence: {
        name: '@deepseek-ai/dsh-session-persistence-jsonl',
        config: { root: '/home/orca/.dsh/sessions/org/s_process', compression: 'zstd' },
      },
      computeTier: 'cpu',
    })
  })

  it('selects resume for a replacement attempt without creating a new session', async () => {
    const result = await run('resume', 1)
    expect(result.exitCode, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).action).toBe('resume:s_process')
  })

  it('propagates a missing-session resume failure and never falls back to create', async () => {
    const result = await run('missing', 1)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/session "s_process" not found/)
    expect(result.stdout).toBe('')
  })
})
