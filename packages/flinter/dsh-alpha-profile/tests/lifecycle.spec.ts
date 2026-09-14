import { describe, expect, it } from 'vitest'
import {
  acceptCurrentWorkerCallback,
  assertCurrentWorkerCallback,
  assertWorkerCanaryProof,
  canaryAllowsFanOut,
  fenceWorkerAttempt,
  type WorkerCanaryProof,
} from '../src/lifecycle.ts'
import type { DshWorkerLaunchContract } from '../src/worker.ts'

const currentLaunch: DshWorkerLaunchContract = {
  dshSessionId: 's_org_job',
  dshSessionRoot: '/var/lib/flinter/sessions/s_org_job',
  leaseOwner: 'worker-b',
  leaseGeneration: 8,
  workerAttemptCount: 2,
}

describe('non-Orca worker lifecycle safety', () => {
  it('rejects callbacks from an older lease generation', () => {
    const stale = { ...currentLaunch, leaseGeneration: 7, workerAttemptCount: 1 }
    expect(() => assertCurrentWorkerCallback(currentLaunch, stale)).toThrow(/stale leaseGeneration/)
    expect(acceptCurrentWorkerCallback(currentLaunch, stale)).toBeUndefined()
  })

  it('rejects a callback that changes the durable session identity', () => {
    expect(() => assertCurrentWorkerCallback(currentLaunch, {
      ...currentLaunch,
      dshSessionId: 'other-session',
    })).toThrow(/stale dshSessionId/)
  })

  it('waits for the executor terminal state after requesting a stop', async () => {
    const events: string[] = []
    const terminal = await fenceWorkerAttempt({
      requestStop: async (attempt) => {
        events.push(`stop:${attempt.workerAttemptCount}`)
      },
      waitForTerminal: async (attempt) => {
        events.push(`wait:${attempt.workerAttemptCount}`)
        return { terminal: true, state: 'STOPPED', observedAt: '2026-08-29T13:00:00.000Z' }
      },
    }, currentLaunch)

    expect(events).toEqual(['stop:2', 'wait:2'])
    expect(terminal.state).toBe('STOPPED')
  })

  it('fails closed when the executor has not confirmed a terminal state', async () => {
    await expect(fenceWorkerAttempt({
      requestStop: async () => undefined,
      waitForTerminal: async () => ({ terminal: false, state: 'STOPPING' }),
    }, currentLaunch)).rejects.toThrow(/terminal executor state/)
  })

  it('requires the complete canary before fan-out', () => {
    const complete: WorkerCanaryProof = {
      startupReady: true,
      taskReceivedLiterally: true,
      sessionPersisted: true,
      callbackAccepted: true,
      completionRecorded: true,
      artifactProduced: true,
    }
    expect(assertWorkerCanaryProof(complete, { requireArtifact: true })).toEqual(complete)
    expect(canaryAllowsFanOut(complete, { requireArtifact: true })).toBe(true)
    expect(canaryAllowsFanOut({ ...complete, sessionPersisted: false })).toBe(false)
    expect(canaryAllowsFanOut({ ...complete, artifactProduced: false }, { requireArtifact: true })).toBe(false)
  })
})
