import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import AwsSecretsManagerCredentialProvider from '@deepseek-ai/dsh-credentials-aws-secrets-manager'
import type { Config as AwsSecretsManagerConfig } from '@deepseek-ai/dsh-credentials-aws-secrets-manager'
import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import {
  bindFreshSession,
  buildFlinterProviderSettings,
  buildFlinterProfileComposition,
  consumeFlinterNativeSessionEvents,
  DIRECT_DEEPSEEK_ROUTE,
  FLINTER_AWS_SECRET_NAMES,
  FLINTER_CREDENTIAL_REFS,
  FLINTER_NATIVE_EVENT_TYPES,
  FLINTER_MODEL_CAPACITIES,
  freshSessionProvider,
  PI_AI_DEFAULTS,
} from '../src/index.ts'
import { SessionId } from '@deepseek-ai/dsh-session'

const mockSend = vi.fn()

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class MockSecretsManagerClient {
    send = mockSend
    destroy = vi.fn()
  },
  GetSecretValueCommand: vi.fn(),
  DescribeSecretCommand: vi.fn(),
  CreateSecretCommand: vi.fn(),
  PutSecretValueCommand: vi.fn(),
  DeleteSecretCommand: vi.fn(),
}))

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
    expect(settings.providers['ark-agent-plan'].models[0].compat).toEqual({ supportsDeveloperRole: false })
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
            secretNames: {
              [FLINTER_CREDENTIAL_REFS.arkAgentPlan]: FLINTER_AWS_SECRET_NAMES.arkAgentPlan,
              [FLINTER_CREDENTIAL_REFS.modelflare]: FLINTER_AWS_SECRET_NAMES.modelflare,
              [FLINTER_CREDENTIAL_REFS.gmiServing]: FLINTER_AWS_SECRET_NAMES.gmiServing,
              [FLINTER_CREDENTIAL_REFS.deepseekOfficial]: FLINTER_AWS_SECRET_NAMES.deepseekOfficial,
            },
          },
        }],
      },
    ])
    expect(JSON.stringify(aws)).not.toMatch(/(?:api[_-]?key|secret|token)\s*[:=]\s*[^,}]+/i)
  })

  it.each([
    ['arkAgentPlan', FLINTER_CREDENTIAL_REFS.arkAgentPlan, FLINTER_AWS_SECRET_NAMES.arkAgentPlan],
    ['modelflare', FLINTER_CREDENTIAL_REFS.modelflare, FLINTER_AWS_SECRET_NAMES.modelflare],
    ['gmiServing', FLINTER_CREDENTIAL_REFS.gmiServing, FLINTER_AWS_SECRET_NAMES.gmiServing],
    ['deepseekOfficial', FLINTER_CREDENTIAL_REFS.deepseekOfficial, FLINTER_AWS_SECRET_NAMES.deepseekOfficial],
  ] as const)('maps %s profile reference to its AWS secret name at provider request time', async (_route, reference, secretName) => {
    const aws = buildFlinterProfileComposition('aws-worker')
    const patch = aws.patches[1]
    expect(patch).toBeDefined()
    if (patch === undefined || !('insert' in patch)) throw new Error('AWS credentials patch is missing')
    const config: AwsSecretsManagerConfig = patch.insert[0].config
    mockSend.mockReset()
    vi.mocked(GetSecretValueCommand).mockClear()
    mockSend.mockResolvedValue({ SecretString: JSON.stringify({ [reference]: 'fixture-value' }) })

    const provider = new AwsSecretsManagerCredentialProvider(new Context(), config)
    await expect(provider.resolve(credentialRef(reference)))
      .resolves.toEqual({ value: 'fixture-value', source: 'aws-secrets-manager' })
    expect(vi.mocked(GetSecretValueCommand)).toHaveBeenCalledWith({
      SecretId: secretName,
    })
    expect(mockSend).toHaveBeenCalledOnce()
  })

  it('consumes native events without dropping opaque plugin records', () => {
    const session = {
      version: 0,
      id: SessionId('native-consumer'),
      createdAt: 1,
      delegationDepth: 0,
    }
    const events = [
      { type: 'turn/start', seq: 0, time: 2, data: { turn: 0 } },
      { type: 'plugin/opaque', seq: 1, time: 3, data: { value: 'preserve' } },
      { type: 'turn/end', seq: 2, time: 4, data: { turn: 0, reason: { kind: 'completed' } } },
    ] as unknown as import('@deepseek-ai/dsh-session').SessionEvent[]
    const consumed = consumeFlinterNativeSessionEvents(session, events)

    expect(FLINTER_NATIVE_EVENT_TYPES).toContain('turn/start')
    expect(consumed.session).toBe(session)
    expect(consumed.events).toBe(events)
    expect(consumed.items).toHaveLength(4)
    expect(consumed.items[0]).toEqual({ kind: 'session', header: session })
    expect(consumed.items[2]).toEqual({ kind: 'event', event: events[1] })
  })
})
