import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { authContextFrom } from '../../../llm/llm-pi-ai/src/auth.ts'
import { describe, expect, it } from 'vitest'
import {
  FLINTER_AWS_SECRET_NAMES,
  MockAwsSecretsManagerCredentialProvider,
} from '../src/index.ts'

const VALUES = Object.freeze({
  'flinter/dsh-ark-agent-plan': 'probe-ark-value',
  'flinter/dsh-modelflare': 'probe-modelflare-value',
  'flinter/dsh-gmi-serving': 'probe-gmi-value',
  'flinter/dsh-deepseek-official': 'probe-deepseek-value',
})

describe('Phase 1 mock AWS credential provider', () => {
  it('resolves all model refs through the alpha credential seam without exposing values in descriptions', async () => {
    const values = new Map(Object.entries(VALUES))
    const ctx = new Context()
    const fiber = ctx.plugin(MockAwsSecretsManagerCredentialProvider, {
      readSecret: async secretName => values.get(secretName),
      agentBoxSecretNames: { workerRole: 'separate/gmi-agentbox-infra' },
    })
    await fiber

    for (const [refName, secretName] of Object.entries(FLINTER_AWS_SECRET_NAMES)) {
      const ref = credentialRef(refName)
      await expect(ctx.credentials.resolve(ref)).resolves.toEqual({
        value: VALUES[secretName as keyof typeof VALUES],
        source: `aws-secrets-manager:${secretName}`,
      })
      const description = await ctx.credentials.describe(ref)
      expect(description).toMatchObject({
        configured: true,
        writable: false,
        secretName,
        agentBoxNamespacePresent: true,
      })
      expect(JSON.stringify(description)).not.toContain(VALUES[secretName as keyof typeof VALUES])
    }

    await fiber.dispose()
  })

  it('resolves at request time and rejects writes', async () => {
    const values = new Map<string, string>([['flinter/dsh-ark-agent-plan', 'first-value']])
    const ctx = new Context()
    const fiber = ctx.plugin(MockAwsSecretsManagerCredentialProvider, {
      readSecret: async secretName => values.get(secretName),
    })
    await fiber
    const ref = credentialRef('ARK_PLAN_API_KEY')

    await expect(ctx.credentials.resolve(ref)).resolves.toMatchObject({ value: 'first-value' })
    values.set('flinter/dsh-ark-agent-plan', 'second-value')
    await expect(ctx.credentials.resolve(ref)).resolves.toMatchObject({ value: 'second-value' })
    await expect(ctx.credentials.set(ref, 'attempted-write')).rejects.toThrow(/read-only/)
    await expect(ctx.credentials.unset(ref)).rejects.toThrow(/read-only/)

    await fiber.dispose()
  })

  it('feeds the same refs through pi-ai authContextFrom', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(MockAwsSecretsManagerCredentialProvider, {
      readSecret: async secretName => `resolved:${secretName}`,
    })
    await fiber

    const auth = authContextFrom(ctx)
    await expect(auth.env('ARK_PLAN_API_KEY')).resolves.toBe('resolved:flinter/dsh-ark-agent-plan')
    await expect(auth.env('DEEPSEEK_API_KEY')).resolves.toBe('resolved:flinter/dsh-deepseek-official')
    await fiber.dispose()
  })
})
