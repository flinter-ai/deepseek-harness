import { describe, expect, it } from 'vitest'
import {
  bindFreshSession,
  buildFlinterProviderSettings,
  DIRECT_DEEPSEEK_ROUTE,
  FLINTER_AWS_SECRET_NAMES,
  FLINTER_CREDENTIAL_REFS,
  FLINTER_MODEL_CAPACITIES,
  freshSessionProvider,
  PI_AI_DEFAULTS,
} from '../src/index.ts'

const endpoints = {
  arkAgentPlan: 'http://127.0.0.1:4101/v1',
  modelflare: 'http://127.0.0.1:4102/v1',
  gmiServing: 'http://127.0.0.1:4103/v1',
}

describe('FLINTER alpha provider/profile layer', () => {
  it('builds the three explicit pi-ai routes with credential references only', () => {
    const settings = buildFlinterProviderSettings(endpoints)
    expect(Object.keys(settings.providers)).toEqual(['ark-agent-plan', 'modelflare', 'gmi-serving'])
    expect(settings.providers['ark-agent-plan'].models[0].id).toBe('ark-code-latest')
    expect(settings.providers.modelflare.models[0].id).toBe('gpt-5.6-sol')
    expect(settings.providers['gmi-serving'].models[0].id).toBe('deepseek-ai/DeepSeek-V4-Flash-0731')
    expect(settings.providers['ark-agent-plan'].apiKeyEnv).toBe(FLINTER_CREDENTIAL_REFS.arkAgentPlan)
    expect(JSON.stringify(settings)).not.toContain('api_key')
    expect(JSON.stringify(settings)).not.toContain('secret')
  })

  it('uses verified alpha pi-ai numeric defaults', () => {
    const settings = buildFlinterProviderSettings(endpoints)
    expect(settings.providers['ark-agent-plan'].defaultContextWindow).toBe(PI_AI_DEFAULTS.contextWindow)
    expect(settings.providers['ark-agent-plan'].models[0]).toMatchObject(FLINTER_MODEL_CAPACITIES.arkCodeLatest)
    expect(settings.providers['ark-agent-plan'].models[0].reasoningEfforts).toEqual({ high: 'high' })
    expect(settings.providers.modelflare.models[0]).toMatchObject(FLINTER_MODEL_CAPACITIES.modelflareGpt56Sol)
    expect(settings.providers.modelflare.models[0].reasoningEfforts).toEqual({ high: 'high' })
    expect(settings.providers['gmi-serving'].models[0]).toMatchObject(FLINTER_MODEL_CAPACITIES.gmiDeepSeekV4Flash)
    expect(settings.providers.modelflare.models[0]).not.toHaveProperty('maxTokens')
    expect(settings.providers.modelflare.defaultMaxTokens).toBe(PI_AI_DEFAULTS.maxTokens)
  })

  it('rotates only fresh-session defaults at the UTC boundary', () => {
    expect(freshSessionProvider(new Date('2026-08-29T15:59:00Z'))).toBe('modelflare')
    expect(freshSessionProvider(new Date('2026-08-29T16:00:00Z'))).toBe('ark-agent-plan')
    expect(freshSessionProvider(new Date('2026-08-29T23:59:00Z'))).toBe('ark-agent-plan')
    expect(freshSessionProvider(new Date('2026-08-30T00:00:00Z'))).toBe('modelflare')

    const oldSession = bindFreshSession(new Date('2026-08-29T15:59:00Z'), endpoints)
    const freshSession = bindFreshSession(new Date('2026-08-29T16:00:00Z'), endpoints)
    expect(oldSession).toEqual({ provider: 'modelflare', model: 'gpt-5.6-sol' })
    expect(freshSession).toEqual({ provider: 'ark-agent-plan', model: 'ark-code-latest' })
  })

  it('keeps AWS secret names separate from model credential references', () => {
    expect(FLINTER_AWS_SECRET_NAMES.gmiServing).toBe('flinter/dsh-gmi-serving')
    expect(FLINTER_AWS_SECRET_NAMES.gmiServing).not.toBe(FLINTER_CREDENTIAL_REFS.gmiServing)
    expect(DIRECT_DEEPSEEK_ROUTE).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
    })
  })
})
