import { describe, expect, it } from 'vitest'
import {
  CodeSandboxComputeBackend,
  DSH_COMPUTE_ENV,
  DSH_COMPUTE_BACKENDS,
  DEFAULT_DSH_COMPUTE_ADMISSION_POLICY,
  DshComputeAdmission,
  DshComputeBackendSelector,
  readDshComputeAdmissionPolicy,
} from '../src/compute.ts'

describe('platform-neutral compute contract', () => {
  it('defaults to one bounded CodeSandbox worker and accepts explicit platform policy', () => {
    expect(DSH_COMPUTE_BACKENDS).toEqual(['codesandbox', 'ec2', 'local'])
    expect(readDshComputeAdmissionPolicy()).toEqual(DEFAULT_DSH_COMPUTE_ADMISSION_POLICY)
    expect(readDshComputeAdmissionPolicy({
      [DSH_COMPUTE_ENV.backend]: 'ec2',
      [DSH_COMPUTE_ENV.maxConcurrent]: '2',
      [DSH_COMPUTE_ENV.maxConcurrentPerBackend]: '1',
      [DSH_COMPUTE_ENV.maxWallTimeMs]: '900000',
      [DSH_COMPUTE_ENV.maxIdleTimeMs]: '60000',
      [DSH_COMPUTE_ENV.hibernationTimeoutSeconds]: '120',
    })).toMatchObject({
      backend: 'ec2',
      maxConcurrent: 2,
      maxConcurrentPerBackend: 1,
      maxWallTimeMs: 900000,
      maxIdleTimeMs: 60000,
      hibernationTimeoutSeconds: 120,
    })
    expect(() => readDshComputeAdmissionPolicy({
      [DSH_COMPUTE_ENV.maxConcurrent]: '1',
      [DSH_COMPUTE_ENV.maxConcurrentPerBackend]: '2',
    })).toThrow(/must not exceed total capacity/)
    const ec2Admission = new DshComputeAdmission(readDshComputeAdmissionPolicy({
      [DSH_COMPUTE_ENV.backend]: 'ec2',
    }))
    const ec2Lease = ec2Admission.acquire({
      sessionId: 'session-ec2', attemptId: 'attempt-0', leaseOwner: 'worker', leaseGeneration: 0,
    })
    expect(ec2Lease.backend).toBe('ec2')
    ec2Lease.release()
  })

  it('prevents duplicate attempts and concurrent replacement bursts until release', () => {
    const admission = new DshComputeAdmission({
      ...DEFAULT_DSH_COMPUTE_ADMISSION_POLICY,
      maxConcurrent: 2,
      maxConcurrentPerBackend: 2,
    })
    const first = admission.acquire({
      sessionId: 'session-a',
      attemptId: 'attempt-0',
      leaseOwner: 'worker-a',
      leaseGeneration: 0,
      backend: 'codesandbox',
    })
    expect(() => admission.acquire({
      sessionId: 'session-a',
      attemptId: 'attempt-0',
      leaseOwner: 'worker-a',
      leaseGeneration: 0,
      backend: 'codesandbox',
    })).toThrowError(expect.objectContaining({ code: 'COMPUTE_ATTEMPT_ACTIVE' }))
    expect(() => admission.acquire({
      sessionId: 'session-a',
      attemptId: 'attempt-1',
      leaseOwner: 'worker-b',
      leaseGeneration: 1,
      backend: 'codesandbox',
    })).toThrowError(expect.objectContaining({ code: 'COMPUTE_SESSION_ACTIVE' }))
    expect(admission.activeCount).toBe(1)
    first.assertCurrent()
    first.release()
    expect(first.released).toBe(true)
    expect(() => first.assertCurrent()).toThrowError(expect.objectContaining({
      code: 'COMPUTE_LEASE_NOT_CURRENT',
    }))
    const replacement = admission.acquire({
      sessionId: 'session-a',
      attemptId: 'attempt-1',
      leaseOwner: 'worker-b',
      leaseGeneration: 1,
      backend: 'codesandbox',
    })
    expect(replacement.attemptId).toBe('attempt-1')
  })

  it('enforces total and per-backend capacity', () => {
    const admission = new DshComputeAdmission({
      ...DEFAULT_DSH_COMPUTE_ADMISSION_POLICY,
      maxConcurrent: 2,
      maxConcurrentPerBackend: 1,
    })
    const first = admission.acquire({
      sessionId: 'session-a', attemptId: 'attempt-0', leaseOwner: 'a', leaseGeneration: 0, backend: 'codesandbox',
    })
    expect(() => admission.acquire({
      sessionId: 'session-b', attemptId: 'attempt-0', leaseOwner: 'b', leaseGeneration: 0, backend: 'codesandbox',
    })).toThrowError(expect.objectContaining({ code: 'COMPUTE_BACKEND_CAPACITY' }))
    const second = admission.acquire({
      sessionId: 'session-b', attemptId: 'attempt-0', leaseOwner: 'b', leaseGeneration: 0, backend: 'ec2',
    })
    expect(() => admission.acquire({
      sessionId: 'session-c', attemptId: 'attempt-0', leaseOwner: 'c', leaseGeneration: 0, backend: 'local',
    })).toThrowError(expect.objectContaining({ code: 'COMPUTE_CAPACITY_EXHAUSTED' }))
    first.release()
    second.release()
  })

  it('selects only configured adapters and rejects duplicate registration', async () => {
    const process = { waitUntilComplete: async () => 'done', stop: async () => undefined }
    const local = { backend: 'local' as const, start: async () => process }
    const selector = new DshComputeBackendSelector([local])
    await expect(selector.start({
      sessionId: 's', attemptId: 'a', argv: ['/bin/true'], cwd: '/', env: {},
    }, 'local')).resolves.toBe(process)
    expect(() => selector.get('ec2')).toThrow(/not configured/)
    expect(() => new DshComputeBackendSelector([local, local])).toThrow(/more than once/)
  })

  it('keeps the CodeSandbox adapter SDK-free, literal, bounded, and secret-safe', async () => {
    const calls: Array<Record<string, unknown>> = []
    let disposed = 0
    const command = {
      waitUntilComplete: async () => 'completed',
      kill: async () => undefined,
    }
    const backend = new CodeSandboxComputeBackend({
      runtime: {
        async createSandbox(options) {
          calls.push({ create: options })
          return {
            id: 'sandbox-1',
            async connect(options) {
              calls.push({ connect: options })
              return {
                commands: {
                  async runBackground(argv, options) {
                    calls.push({ argv, run: options })
                    return command
                  },
                },
              }
            },
          }
        },
        async disposeSandbox() { disposed += 1 },
      },
      templateId: 'dsh-template',
      vmTier: 'micro',
      hibernationTimeoutSeconds: 120,
    })
    const running = await backend.start({
      sessionId: 'session-1',
      attemptId: 'attempt-0',
      argv: ['/opt/dsh/bin/dsh', 'inspect ; literal'],
      cwd: '/workspace',
      env: { DSH_SESSION_ID: 'session-1', DSH_CALLBACK_HMAC_SECRET_REF: 'ref-only' },
    })
    await expect(running.waitUntilComplete()).resolves.toBe('completed')
    expect(calls[0]).toMatchObject({ create: {
      templateId: 'dsh-template', vmTier: 'micro', hibernationTimeoutSeconds: 120,
      automaticWakeupConfig: { http: true, websocket: false },
    } })
    expect(calls[2]).toMatchObject({ argv: ['/opt/dsh/bin/dsh', 'inspect ; literal'] })
    expect(disposed).toBe(1)
    await expect(backend.start({
      sessionId: 'session-1', attemptId: 'attempt-1', argv: ['/bin/true'], cwd: '/',
      env: { OPENROUTER_API_KEY: 'never-forwarded' },
    })).rejects.toThrow(/credential-shaped environment/)
  })
})
