import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, ReasoningEffortId, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { assertDefaultModelReady } from '../src/default-model-ready.ts'

describe('composed default model readiness', () => {
  it('uses real runtime capabilities without invoking model generation', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const stream = vi.fn(() => { throw new Error('readiness must not generate') })
    const adapter = new class extends LlmAdapter {
      stream = stream
    }()
    ctx.llm.registerAdapter(['opencode-go'], adapter)
    let selection: LlmCallConfig = {
      provider: 'opencode-go', model: 'deepseek-flash', reasoningEffort: ReasoningEffortId('off'),
    }
    const services: Record<string, unknown> = {
      agentDefaultModel: { currentSelection: () => selection }, llm: ctx.llm,
    }
    try {
      await expect(assertDefaultModelReady({ get: name => services[name] }))
        .rejects.toMatchObject({ code: 'UNSUPPORTED_REASONING_EFFORT' })
      selection = { provider: 'opencode-go', model: 'deepseek-flash' }
      await expect(assertDefaultModelReady({ get: name => services[name] })).resolves.toBeUndefined()
      expect(stream).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('refuses a stale off selection rather than announcing readiness', async () => {
    const selection = { provider: 'opencode-go', model: 'deepseek-flash', reasoningEffort: 'off' }
    const failure = Object.assign(new Error('unsupported reasoning effort'), { code: 'UNSUPPORTED_REASONING_EFFORT' })
    const resolveCallConfig = vi.fn().mockRejectedValue(failure)
    const services: Record<string, unknown> = {
      agentDefaultModel: { currentSelection: () => selection }, llm: { resolveCallConfig },
    }
    await expect(assertDefaultModelReady({ get: name => services[name] })).rejects.toBe(failure)
    expect(resolveCallConfig).toHaveBeenCalledWith(selection)
  })

  it('preserves omitted effort and accepts adapter-supported explicit values', async () => {
    for (const selection of [
      { provider: 'opencode-go', model: 'deepseek-flash' },
      { provider: 'other', model: 'reasoner', reasoningEffort: 'high' },
    ]) {
      const resolveCallConfig = vi.fn().mockResolvedValue(selection)
      const services: Record<string, unknown> = {
        agentDefaultModel: { currentSelection: () => selection }, llm: { resolveCallConfig },
      }
      await assertDefaultModelReady({ get: name => services[name] })
      expect(resolveCallConfig).toHaveBeenCalledWith(selection)
      expect(selection).not.toHaveProperty('reasoningEffort', 'off')
    }
  })

  it('does not require model services in a custom non-agent profile', async () => {
    await expect(assertDefaultModelReady({ get: () => undefined })).resolves.toBeUndefined()
  })

  it('tolerates a saved provider whose adapter is no longer mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const services: Record<string, unknown> = {
      agentDefaultModel: { currentSelection: () => ({ provider: 'removed', model: 'plain' }) },
      llm: ctx.llm,
    }
    try {
      await expect(assertDefaultModelReady({ get: name => services[name] })).resolves.toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('recognizes NO_ADAPTER across package or realm boundaries by stable code', async () => {
    const foreignError = Object.assign(new Error('unmounted'), { code: 'NO_ADAPTER' })
    const services: Record<string, unknown> = {
      agentDefaultModel: { currentSelection: () => ({ provider: 'removed', model: 'plain' }) },
      llm: { resolveCallConfig: () => Promise.reject(foreignError) },
    }
    await expect(assertDefaultModelReady({ get: name => services[name] })).resolves.toBeUndefined()
  })
})
