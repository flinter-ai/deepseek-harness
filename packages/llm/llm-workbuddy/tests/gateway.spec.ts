import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import * as Workbuddy from '@deepseek-ai/dsh-llm-workbuddy'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe.skipIf(process.env.WORKBUDDY_LIVE_TEST !== '1' || !process.env.WORKBUDDY_API_KEY)('workbuddy2api live gateway', () => {
  it('serves one minimal completion through the moved DSH adapter', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(Workbuddy, {})

    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream({
      provider: 'workbuddy',
      model: 'deepseek-v4-flash',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'Reply with exactly pong.' }],
        source: { kind: 'plugin', plugin: 'workbuddy-live-test' },
      })],
      maxTokens: 16,
    })) assembler.push(chunk)

    expect(assembler.finish.kind).toBe('stop')
    expect(assembler.message({
      kind: 'model', provider: 'workbuddy', model: 'deepseek-v4-flash',
    }).content.some(block => block.type === 'text' && block.text.length > 0)).toBe(true)
  })
})
