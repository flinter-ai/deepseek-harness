import { describe, expect, it } from 'vitest'
import {
  bindFreshSession,
  buildFlinterProviderSettings,
  buildFlinterProfileComposition,
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
    expect(settings.providers['ark-agent-plan'].models[0].reasoningEfforts).toEqual({ off: null, high: 'high' })
    expect(settings.providers.modelflare.models[0]).toMatchObject(FLINTER_MODEL_CAPACITIES.modelflareGpt56Sol)
    expect(settings.providers.modelflare.models[0].reasoningEfforts).toEqual({ off: null, high: 'high' })
    expect(Object.isFrozen(settings.providers.modelflare.models[0].reasoningEfforts)).toBe(false)
    expect(settings.providers['gmi-serving'].models[0]).toMatchObject(FLINTER_MODEL_CAPACITIES.gmiDeepSeekV4Flash)
    expect(settings.providers.modelflare.models[0]).not.toHaveProperty('maxTokens')
    expect(settings.providers.modelflare.defaultMaxTokens).toBe(PI_AI_DEFAULTS.maxTokens)
  })

  it('exposes an explicit per-model reasoning menu without changing other routes', () => {
    const settings = buildFlinterProviderSettings(endpoints, {
      reasoningEfforts: {
        modelflare: { off: null, low: 'low', high: 'high', max: 'ultra' },
        'gmi-serving': false,
      },
    })
    expect(settings.providers.modelflare.models[0].reasoningEfforts).toEqual({
      off: null,
      low: 'low',
      high: 'high',
      max: 'ultra',
    })
    expect(settings.providers['ark-agent-plan'].models[0].reasoningEfforts)
      .toEqual({ off: null, high: 'high' })
    expect(settings.providers['gmi-serving'].models[0].reasoningEfforts).toBe(false)
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

    // A caller may retain a non-default route as its explicit fallback; the
    // rotation window must not rewrite that user choice outside its window.
    expect(freshSessionProvider(new Date('2026-08-29T10:00:00Z'), 'gmi-serving')).toBe('gmi-serving')
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

  it('uses one DSH base/headless composition with only the credential backend swapped', () => {
    const local = buildFlinterProfileComposition('tod')
    const aws = buildFlinterProfileComposition('aws-worker')
    expect(local.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'])
    expect(aws.bundles).toEqual(local.bundles)
    expect(local.credentialPackage).toBe('@deepseek-ai/dsh-credentials-local')
    expect(local.patches).toEqual([])
    expect(aws.credentialPackage).toBe('@deepseek-ai/dsh-credentials-aws-secrets-manager')
    expect(aws.patches).toMatchObject([
      { id: 'credentials', disabled: true },
      {
        insert: [{
          id: 'credentials-aws-secrets-manager',
          name: '@deepseek-ai/dsh-credentials-aws-secrets-manager',
          config: {
            secretFormat: 'json',
            allowWrites: false,
            secretNames: FLINTER_AWS_SECRET_NAMES,
          },
        }],
      },
    ])
    expect(JSON.stringify(aws)).not.toMatch(/(?:api[_-]?key|secret|token)\s*[:=]\s*[^,}]+/i)
  })
})
