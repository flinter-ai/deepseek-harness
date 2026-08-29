/**
 * Scaffold-only native DSH -> FLINTER trace boundary.
 *
 * This surface deliberately carries native events without assigning scientific
 * meaning. Trace-link implementation begins only after the Phase 1 seam gate.
 */

export const SCAFFOLD_STATUS = 'SCAFFOLD_ONLY' as const

export type NativeDshEventType =
  | 'session'
  | 'turn/start'
  | 'request/header'
  | 'request/context'
  | 'user/message'
  | 'assistant/message'
  | 'turn/end'

export interface NativeDshEvent {
  readonly type: NativeDshEventType | (string & {})
  readonly payload: Readonly<Record<string, unknown>>
}

export interface TraceLinkBoundary {
  readonly status: typeof SCAFFOLD_STATUS
  readonly accept: (event: NativeDshEvent) => void
}
