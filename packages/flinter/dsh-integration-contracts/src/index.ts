/** Scaffold-only fixtures; PR #48 remains the control-plane authority. */

export const SCAFFOLD_STATUS = 'SCAFFOLD_ONLY' as const

export type ControlPlaneMilestone = 'T0' | 'T1' | 'T2' | 'T3' | 'T4'

export interface BeamComputeRequest {
  readonly requestId: string
  readonly resourceClass: 'cpu' | 'gpu'
  readonly provenance: string
}

export interface DshControlPlaneIntegrationContract {
  readonly status: typeof SCAFFOLD_STATUS
  readonly milestone: ControlPlaneMilestone
  readonly compute?: BeamComputeRequest
}
