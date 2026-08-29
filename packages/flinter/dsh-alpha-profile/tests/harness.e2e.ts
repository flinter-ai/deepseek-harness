import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { FileSettingsProvider } from '@deepseek-ai/dsh-settings-file'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { assemble } from '../../../llm/llm-pi-ai/tests/assemble.ts'
import { closeMockServers, mockServer, textEvents } from '../../../llm/llm-pi-ai/tests/mock-server.ts'
import { buildFlinterProviderSettings } from '../src/index.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
  await closeMockServers()
})

describe('Phase 1 DSH harness/provider connection', () => {
  it('boots alpha llm-pi-ai with mock routes and resolves credential refs per request', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flinter-dsh-alpha-e2e-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    await writeFile(
      join(dir, '.credentials.yaml'),
      'version: 1\nrefs:\n  ARK_PLAN_API_KEY: ark-test-key\n  MODELFLARE_API_KEY: modelflare-test-key\n  GMI_SERVING_API_KEY: gmi-test-key\n',
      { mode: 0o600 },
    )
    const server = await mockServer([
      { events: textEvents },
      { events: textEvents },
    ])
    const settings = buildFlinterProviderSettings({
      arkAgentPlan: server.url,
      modelflare: server.url,
      gmiServing: server.url,
    })

    const ctx = new Context()
    cleanups.push(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
    await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
    await ctx.plugin(LlmPiAi, settings)

    const modelflare = await assemble(ctx, {
      provider: 'modelflare',
      model: 'gpt-5.6-sol',
      messages: [],
    })
    const gmi = await assemble(ctx, {
      provider: 'gmi-serving',
      model: 'deepseek-ai/DeepSeek-V4-Flash-0731',
      messages: [],
    })

    expect(modelflare.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(gmi.message.content).toEqual([{ type: 'text', text: 'hello' }])
    await expect(ctx.llm.resolveModelInfo('modelflare', 'gpt-5.6-sol'))
      .resolves.toMatchObject({ context: { contextWindow: 1_000_000 } })
    await expect(ctx.llm.resolveModelInfo('gmi-serving', 'deepseek-ai/DeepSeek-V4-Flash-0731'))
      .resolves.toMatchObject({ context: { contextWindow: 1_000_000 } })
    expect(server.headers.map(header => header.authorization)).toEqual([
      'Bearer modelflare-test-key',
      'Bearer gmi-test-key',
    ])
    expect(server.requests).toEqual([
      expect.objectContaining({ model: 'gpt-5.6-sol' }),
      expect.objectContaining({ model: 'deepseek-ai/DeepSeek-V4-Flash-0731' }),
    ])
    expect(JSON.stringify(settings)).not.toContain('ark-test-key')
    expect(JSON.stringify(settings)).not.toContain('modelflare-test-key')
    expect(JSON.stringify(settings)).not.toContain('gmi-test-key')
  })
})
