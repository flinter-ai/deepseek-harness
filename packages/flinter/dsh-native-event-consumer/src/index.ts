/**
 * Phase 1 compatibility probe for the native alpha session event stream.
 * Records remain opaque: this function checks presence and order only and
 * does not patch or reinterpret the Session codec.
 */

export const PHASE_STATUS = 'P1_NATIVE_EVENT_PROBE' as const

export const REQUIRED_NATIVE_EVENT_TYPES = Object.freeze([
  'session',
  'turn/start',
  'request/header',
  'request/context',
  'user/message',
  'assistant/message',
  'turn/end',
] as const)

export type RequiredNativeEventType = typeof REQUIRED_NATIVE_EVENT_TYPES[number]

export type NativeEventRecord = Readonly<Record<string, unknown>>

export interface NativeEventConsumption {
  readonly status: typeof PHASE_STATUS
  readonly accepted: number
  readonly eventTypes: readonly string[]
  readonly missing: readonly RequiredNativeEventType[]
}

/** Consume native events as L0 evidence without assigning FLINTER semantics. */
export function consumeNativeDshEvents(records: readonly NativeEventRecord[]): NativeEventConsumption {
  const eventTypes = records.flatMap(record => typeof record.type === 'string' ? [record.type] : [])
  const present = new Set(eventTypes)
  const missing = REQUIRED_NATIVE_EVENT_TYPES.filter(type => !present.has(type))
  return { status: PHASE_STATUS, accepted: records.length, eventTypes, missing }
}

/** Fail closed when a native session cannot support the compatibility probe. */
export function assertNativeDshEvents(records: readonly NativeEventRecord[]): NativeEventConsumption {
  const consumption = consumeNativeDshEvents(records)
  if (consumption.missing.length > 0) {
    throw new Error(`native DSH event probe missing: ${consumption.missing.join(', ')}`)
  }
  return consumption
}
