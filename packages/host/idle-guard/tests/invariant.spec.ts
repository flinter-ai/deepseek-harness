import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as IdleGuardInvariant from '../src/invariant.ts'

describe('host-idle-guard invariant companion', () => {
  it('reserves the package name against duplicate registration', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(IdleGuardInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-host-idle-guard', () => {})
    }).toThrow(/already registered/)
  })
})
