import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { describe, expect, it, vi } from 'vitest'
import {
  ComputeUnsupportedError,
  DelegatingComputeProvider,
  resolveComputeBackend,
  type ComputeCapabilities,
  type ComputeLease,
  type ComputeProviderOperations,
  type ComputeRunHandle,
} from '../src/index.ts'

const capabilities: ComputeCapabilities = {
  operations: ['command', 'preview'],
  persistentWorkspace: true,
  storage: 'aws',
  network: 'restricted',
  maxConcurrentRuns: 1,
}

const lease: ComputeLease = {
  id: 'lease-1',
  backend: 'ec2',
  workspace: { id: 'workspace-1', revision: 'r1' },
  operation: 'command',
  acquiredAt: 10,
  expiresAt: 20,
  capabilities,
}

const run: ComputeRunHandle = { id: 'run-1', leaseId: lease.id, backend: 'ec2' }

function operations(): ComputeProviderOperations {
  return {
    acquire: vi.fn(async () => lease),
    execute: vi.fn(async () => run),
    status: vi.fn(async () => ({ run, status: 'succeeded' as const, exitCode: 0 })),
    cancel: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
  }
}

describe('compute seam', () => {
  it('delegates the complete lease and run lifecycle without exposing values', async () => {
    const callbacks = operations()
    const provider = new DelegatingComputeProvider(new Context(), 'ec2', capabilities, callbacks)
    const acquired = await provider.acquire({
      workspace: lease.workspace,
      operation: 'command',
      credentialRefs: [credentialRef('OPENROUTER_API_KEY')],
    })
    const started = await provider.execute(acquired, { kind: 'command', argv: ['node', 'build.mjs'] })
    expect(await provider.status(started)).toMatchObject({ status: 'succeeded', exitCode: 0 })
    await provider.cancel(started, 'test cancellation')
    await provider.release(acquired)
    expect(callbacks.acquire).toHaveBeenCalledOnce()
    expect(callbacks.execute).toHaveBeenCalledWith(acquired, { kind: 'command', argv: ['node', 'build.mjs'] })
    expect(callbacks.cancel).toHaveBeenCalledWith(started, 'test cancellation')
    expect(callbacks.release).toHaveBeenCalledWith(acquired)
  })

  it('rejects operations that the selected backend did not advertise', async () => {
    const callbacks = operations()
    const commandOnly = { ...capabilities, operations: ['command'] as const }
    const provider = new DelegatingComputeProvider(new Context(), 'ec2', commandOnly, callbacks)
    await expect(provider.acquire({ workspace: lease.workspace, operation: 'preview' })).rejects.toBeInstanceOf(ComputeUnsupportedError)
    expect(callbacks.acquire).not.toHaveBeenCalled()
  })

  it('fences callbacks to the selected backend and lease', async () => {
    const callbacks = operations()
    const provider = new DelegatingComputeProvider(new Context(), 'ec2', capabilities, callbacks)
    await expect(provider.execute({ ...lease, backend: 'sandpack' }, { kind: 'command', argv: ['true'] })).rejects.toThrow('backend "sandpack"')
    await expect(provider.execute(lease, { kind: 'command', argv: ['true'] })).resolves.toEqual(run)
  })

  it('requires an explicit backend and never silently falls back', () => {
    expect(resolveComputeBackend({}, { DSH_COMPUTE_BACKEND: 'sandpack' })).toBe('sandpack')
    expect(resolveComputeBackend({ backend: 'ec2' }, { DSH_COMPUTE_BACKEND: 'sandpack' })).toBe('ec2')
    expect(() => resolveComputeBackend({}, {})).toThrow('set compute backend explicitly')
  })

  it('validates exact argv and bounded output before calling the host', async () => {
    const callbacks = operations()
    const provider = new DelegatingComputeProvider(new Context(), 'ec2', capabilities, callbacks)
    await expect(provider.execute(lease, { kind: 'command', argv: [] })).rejects.toThrow('argv')
    await expect(provider.execute(lease, { kind: 'command', argv: ['true'], maxOutputBytes: 0 })).rejects.toThrow('maxOutputBytes')
    expect(callbacks.execute).not.toHaveBeenCalled()
  })
})
