/** Scaffold-only DSH session/control-plane compatibility surface. */

export const SCAFFOLD_STATUS = 'SCAFFOLD_ONLY' as const

export interface NativeControlState {
  readonly sessionId: string
  readonly status: string
  readonly metadata: Readonly<Record<string, unknown>>
}

export interface AgenticControlBoundary {
  readonly status: typeof SCAFFOLD_STATUS
  readonly project: (state: NativeControlState) => unknown
}
