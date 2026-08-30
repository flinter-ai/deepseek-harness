import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { credentialRef, type CredentialKey } from '@deepseek-ai/dsh-credentials'
import {
  DescribeSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from '@aws-sdk/client-secrets-manager'
import AwsSecretsManagerCredentialProvider, { resolveSpec } from '../src/index.ts'

const mockSend = vi.fn()
const mockDestroy = vi.fn()

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class MockSecretsManagerClient {
    send = mockSend
    destroy = mockDestroy
  },
  GetSecretValueCommand: vi.fn(),
  DescribeSecretCommand: vi.fn(),
  CreateSecretCommand: vi.fn(),
  PutSecretValueCommand: vi.fn(),
  DeleteSecretCommand: vi.fn(),
}))

function makeProvider(config: ConstructorParameters<typeof AwsSecretsManagerCredentialProvider>[1] = {}) {
  const ctx = new Context()
  mockSend.mockReset()
  mockDestroy.mockReset()
  return { provider: new AwsSecretsManagerCredentialProvider(ctx, config), send: mockSend }
}

describe('resolveSpec', () => {
  it('keeps public mappings and defaults writes off', () => {
    expect(resolveSpec({
      secretNames: { ARK_PLAN_API_KEY: 'flinter/dsh-ark-agent-plan' },
    })).toEqual({
      secretPrefix: '/dsh/',
      secretNames: { ARK_PLAN_API_KEY: 'flinter/dsh-ark-agent-plan' },
      secretFormat: 'json',
      allowWrites: false,
    })
  })
})

describe('AwsSecretsManagerCredentialProvider', () => {
  it('resolves a mapped JSON secret at request time', async () => {
    const { provider, send } = makeProvider({
      secretNames: { ARK_PLAN_API_KEY: 'flinter/dsh-ark-agent-plan' },
    })
    send.mockResolvedValue({ SecretString: '{"ARK_PLAN_API_KEY":"mock-value"}' })
    await expect(provider.resolve(credentialRef('ARK_PLAN_API_KEY')))
      .resolves.toEqual({ value: 'mock-value', source: 'aws-secrets-manager' })
    expect(send).toHaveBeenCalledWith(expect.any(GetSecretValueCommand))
  })

  it('supports a plain secret and reports only source metadata', async () => {
    const { provider, send } = makeProvider({ secretFormat: 'plain' })
    send.mockResolvedValueOnce({ SecretString: 'mock-value' })
    send.mockResolvedValueOnce({})
    await expect(provider.resolve(credentialRef('MODELFLARE_API_KEY')))
      .resolves.toEqual({ value: 'mock-value', source: 'aws-secrets-manager' })
    await expect(provider.describe(credentialRef('MODELFLARE_API_KEY')))
      .resolves.toEqual({ configured: true, source: 'aws-secrets-manager', writable: false })
    expect(send).toHaveBeenCalledWith(expect.any(DescribeSecretCommand))
  })

  it('treats a missing secret as unconfigured', async () => {
    const { provider, send } = makeProvider()
    send.mockRejectedValue({ name: 'ResourceNotFoundException' })
    await expect(provider.resolve(credentialRef('MISSING'))).resolves.toBeUndefined()
    await expect(provider.describe(credentialRef('MISSING')))
      .resolves.toEqual({ configured: false, writable: false })
  })

  it('fails closed for writes by default', async () => {
    const { provider, send } = makeProvider()
    await expect(provider.set(credentialRef('ARK_PLAN_API_KEY'), 'mock-value'))
      .rejects.toThrow(/set is disabled/)
    await expect(provider.unset(credentialRef('ARK_PLAN_API_KEY')))
      .rejects.toThrow(/unset is disabled/)
    expect(send).not.toHaveBeenCalled()
  })

  it('supports explicitly enabled writes without exposing the value in metadata', async () => {
    const { provider, send } = makeProvider({ allowWrites: true })
    send.mockResolvedValue({})
    await provider.set(credentialRef('MODELFLARE_API_KEY'), 'mock-value')
    expect(send).toHaveBeenCalledWith(expect.any(PutSecretValueCommand))
    expect(JSON.stringify(resolveSpec({ allowWrites: true }))).not.toContain('mock-value')
  })

  it('keeps record operations out of this reference-only adapter', async () => {
    const { provider } = makeProvider()
    const key = 'llm-pi-ai/route' as CredentialKey
    await expect(provider.readRecord(key)).resolves.toBeUndefined()
    await expect(provider.describeRecord(key)).resolves.toEqual({ configured: false, writable: false })
    await expect(provider.listRecords()).resolves.toEqual([])
    await expect(provider.deleteRecord(key)).rejects.toThrow(/record operations are not supported/)
  })

  it('destroys its SDK client during service disposal', () => {
    const { provider } = makeProvider()
    const disposer = provider[Service.init]().next().value
    if (typeof disposer !== 'function') throw new Error('provider did not yield a disposer')
    disposer()
    expect(mockDestroy).toHaveBeenCalledOnce()
  })
})
