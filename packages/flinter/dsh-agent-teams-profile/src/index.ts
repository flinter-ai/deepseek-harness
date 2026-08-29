/** Scaffold-only descriptor; upstream Agent Teams remains experimental. */

export const PROFILE_STATUS = 'SCAFFOLD_ONLY' as const

export interface AgentTeamsProfileDescriptor {
  readonly status: typeof PROFILE_STATUS
  readonly sourceCheckoutOnly: boolean
  readonly sharedCheckoutLimitation: true
}
