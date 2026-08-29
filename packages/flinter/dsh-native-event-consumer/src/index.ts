/** Phase 1 will replace this scaffold with the tiny native-event consumer. */

export const SCAFFOLD_STATUS = 'SCAFFOLD_ONLY' as const

export interface NativeEventRecord {
  readonly type: string
  readonly payload: Readonly<Record<string, unknown>>
}

export interface NativeEventConsumerBoundary {
  readonly status: typeof SCAFFOLD_STATUS
  readonly consume: (events: readonly NativeEventRecord[]) => unknown
}
