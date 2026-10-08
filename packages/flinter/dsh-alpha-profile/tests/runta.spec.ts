import { describe, expect, it, vi } from 'vitest'
import { RuntaComputeBackend } from '../src/runta.ts'

describe('Runta compute adapter', () => {
  it('wakes a sleeping runtime, waits for readiness, and executes by explicit id', async () => {
    const states = ['sleeping', 'starting', 'ready'] as const
    let inspected = 0
    const command = { waitUntilComplete: vi.fn(async () => 'done'), stop: vi.fn(async () => undefined) }
    const runtime = {
      inspect: vi.fn(async () => ({ state: states[Math.min(inspected++, states.length - 1)] })),
      wake: vi.fn(async () => undefined),
      exec: vi.fn(async () => command),
      stop: vi.fn(async () => undefined),
    }
    const backend = new RuntaComputeBackend({ runtime, runtimeId: 'rt-1', readinessPollMs: 1, readinessTimeoutMs: 100 })
    const running = await backend.start({ sessionId: 's', attemptId: 'a', argv: ['/opt/dsh/bin/dsh'], cwd: '/', env: {} })
    expect(runtime.wake).toHaveBeenCalledWith('rt-1')
    expect(runtime.exec).toHaveBeenCalledWith('rt-1', expect.objectContaining({ attemptId: 'a' }))
    await expect(running.waitUntilComplete()).resolves.toBe('done')
    await running.stop()
    expect(command.stop).toHaveBeenCalledOnce()
    expect(runtime.stop).toHaveBeenCalledWith('rt-1')
  })

  it('fails with a bounded readiness error and never executes', async () => {
    const runtime = {
      inspect: vi.fn(async () => ({ state: 'starting' as const })),
      wake: vi.fn(async () => undefined),
      exec: vi.fn(),
      stop: vi.fn(async () => undefined),
    }
    const backend = new RuntaComputeBackend({ runtime, runtimeId: 'rt-2', readinessPollMs: 1, readinessTimeoutMs: 2 })
    await expect(backend.start({ sessionId: 's', attemptId: 'a', argv: ['/bin/true'], cwd: '/', env: {} }))
      .rejects.toThrow(/did not become ready/)
    expect(runtime.exec).not.toHaveBeenCalled()
  })

  it('requires an explicit runtime id', () => {
    expect(() => new RuntaComputeBackend({
      runtime: {} as never,
      runtimeId: '  ',
    })).toThrow(/runtimeId is required/)
  })
})
