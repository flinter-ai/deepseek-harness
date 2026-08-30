export type ComputeCapability = 'cpu' | 'gpu' | 'beam'

export interface DshControlPlaneTask {
  readonly taskId: string
  readonly organizationId: string
  readonly dshSessionId: string
  readonly dshSessionRoot: string
  readonly attempt: number
  readonly leaseGeneration: number
  readonly profile: 'tod' | 'aws-worker'
  readonly capability: ComputeCapability
}

export interface BeamComputeRequest {
  readonly capability: 'beam'
  readonly resourceProfile: string
  readonly reason: string
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/

function id(value: string, label: string): string {
  if (!ID_RE.test(value)) throw new Error(`${label} is invalid`)
  return value
}

/** Validate the task identity crossing from the control plane into DSH. */
export function validateDshControlPlaneTask(input: DshControlPlaneTask): DshControlPlaneTask {
  id(input.taskId, 'taskId')
  id(input.organizationId, 'organizationId')
  id(input.dshSessionId, 'dshSessionId')
  if (typeof input.dshSessionRoot !== 'string' || input.dshSessionRoot.length === 0) throw new Error('dshSessionRoot is required')
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 0) throw new Error('attempt is invalid')
  if (!Number.isSafeInteger(input.leaseGeneration) || input.leaseGeneration < 0) throw new Error('leaseGeneration is invalid')
  if (!['tod', 'aws-worker'].includes(input.profile)) throw new Error('profile is invalid')
  if (!['cpu', 'gpu', 'beam'].includes(input.capability)) throw new Error('capability is invalid')
  return Object.freeze({ ...input })
}

/** Beam remains an executor/control-plane capability request, never a Phase 1 provider. */
export function validateBeamComputeRequest(request: BeamComputeRequest): BeamComputeRequest {
  id(request.resourceProfile, 'resourceProfile')
  if (request.reason.trim().length === 0) throw new Error('reason is required')
  return Object.freeze({ ...request })
}
