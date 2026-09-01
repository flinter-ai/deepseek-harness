import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import * as Workbuddy from '@deepseek-ai/dsh-llm-workbuddy'

let context: Context | undefined
let server: Server | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (server !== undefined) await new Promise<void>(resolve => server!.close(() => resolve()))
  server = undefined
  vi.unstubAllEnvs()
})

describe('workbuddy DSH integration', () => {
  it('mounts the route and streams through the shared LLM service', async () => {
    vi.stubEnv('WORKBUDDY_API_KEY', 'local-integration-key')
    let requestPath: string | undefined
    let authorization: string | undefined
    let requestBody: { model?: string } | undefined

    server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => { body += chunk.toString() })
      request.on('end', () => {
        requestPath = request.url
        authorization = request.headers.authorization
        requestBody = JSON.parse(body) as { model?: string }
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end([
          'data: {"choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}',
          'data: {"choices":[{"delta":{"content":"pong"},"index":0,"finish_reason":null}]}',
          'data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
          'data: [DONE]',
          '',
        ].join('\n\n'))
      })
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('integration server did not bind')

    context = new Context()
    await context.plugin(LlmRuntime)
    await context.plugin(Workbuddy, {
      baseURL: `http://127.0.0.1:${address.port}/v1`,
    })

    expect(context.llm.listProviders().map(provider => provider.id)).toEqual(['workbuddy'])

    const assembler = new BlockAssembler()
    for await (const chunk of context.llm.stream({
      provider: 'workbuddy',
      model: 'deepseek-v4-flash',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'Reply with exactly pong.' }],
        source: { kind: 'plugin', plugin: 'workbuddy-integration-test' },
      })],
      maxTokens: 16,
    })) assembler.push(chunk)

    expect(requestPath).toBe('/v1/chat/completions')
    expect(authorization).toBe('Bearer local-integration-key')
    expect(requestBody).toMatchObject({ model: 'deepseek-v4-flash' })
    expect(assembler.finish).toEqual({ kind: 'stop' })
    expect(assembler.message({
      kind: 'model', provider: 'workbuddy', model: 'deepseek-v4-flash',
    }).content).toEqual([{ type: 'text', text: 'pong' }])
  })
})
