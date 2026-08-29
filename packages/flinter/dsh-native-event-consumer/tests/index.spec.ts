import { describe, expect, it } from 'vitest'
import {
  assertNativeDshEvents,
  consumeNativeDshEvents,
  REQUIRED_NATIVE_EVENT_TYPES,
} from '../src/index.ts'

describe('@flinter/dsh-native-event-consumer Phase 1 probe', () => {
  it('accepts the native event set without transforming records', () => {
    const records = REQUIRED_NATIVE_EVENT_TYPES.map(type => ({ type, data: { opaque: true } }))
    expect(consumeNativeDshEvents(records)).toMatchObject({
      status: 'P1_NATIVE_EVENT_PROBE',
      accepted: records.length,
      missing: [],
    })
    expect(records).toEqual(REQUIRED_NATIVE_EVENT_TYPES.map(type => ({ type, data: { opaque: true } })))
  })

  it('fails closed when a required native event is absent', () => {
    expect(() => assertNativeDshEvents([{ type: 'session' }])).toThrow(/turn\/start/)
  })
})
