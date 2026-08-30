import { describe, expect, it } from 'vitest'
import { parseNodeVersion, satisfiesNodeEngine, verifyNodeRuntime } from './verify-node-runtime.mjs'

describe('verify-node-runtime', () => {
  it('accepts the supported Node 22 floor and Node 24+', () => {
    const engine = '^22.19.0 || >=24.0.0'
    expect(satisfiesNodeEngine(parseNodeVersion('22.19.0'), engine)).toBe(true)
    expect(satisfiesNodeEngine(parseNodeVersion('24.20.0'), engine)).toBe(true)
    expect(satisfiesNodeEngine(parseNodeVersion('25.2.1'), engine)).toBe(true)
  })

  it('rejects Node 22.16 and the unsupported Node 23 line', () => {
    const engine = '^22.19.0 || >=24.0.0'
    expect(satisfiesNodeEngine(parseNodeVersion('22.16.0'), engine)).toBe(false)
    expect(satisfiesNodeEngine(parseNodeVersion('23.11.0'), engine)).toBe(false)
  })

  it('matches the checked-in repository contract', () => {
    expect(verifyNodeRuntime('24.20.0').engine).toBe('^22.19.0 || >=24.0.0')
  })
})
