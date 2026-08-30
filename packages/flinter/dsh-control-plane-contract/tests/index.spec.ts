import { describe, expect, it } from 'vitest'
import { validateBeamComputeRequest, validateDshControlPlaneTask } from '../src/index.ts'

describe('control-plane and Beam integration contract', () => {
  it('validates the same-session worker task identity', () => {
    expect(validateDshControlPlaneTask({
      taskId: 'task-1', organizationId: 'org-1', dshSessionId: 'session-1', dshSessionRoot: '/sessions/session-1',
      attempt: 1, leaseGeneration: 5, profile: 'aws-worker', capability: 'cpu',
    })).toMatchObject({ profile: 'aws-worker', dshSessionId: 'session-1' })
  })

  it('keeps Beam as an explicit capability request', () => {
    expect(validateBeamComputeRequest({ capability: 'beam', resourceProfile: 'gpu-small', reason: 'bounded deterministic compute' })).toMatchObject({ capability: 'beam' })
  })

  it('rejects invalid task identity', () => {
    expect(() => validateDshControlPlaneTask({
      taskId: 'task/with/slash', organizationId: 'org-1', dshSessionId: 'session-1', dshSessionRoot: '/sessions/session-1',
      attempt: 0, leaseGeneration: 1, profile: 'tod', capability: 'cpu',
    })).toThrow(/taskId/)
  })
})
