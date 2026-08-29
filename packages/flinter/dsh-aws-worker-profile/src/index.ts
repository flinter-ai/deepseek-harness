/** Scaffold-only future AWS worker profile descriptor. */

export const PROFILE_STATUS = 'SCAFFOLD_ONLY' as const

export interface AwsWorkerProfileDescriptor {
  readonly status: typeof PROFILE_STATUS
  readonly credentialProvider: 'dsh-credentials'
  readonly writesAwsState: false
}
