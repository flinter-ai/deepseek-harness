import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from '@aws-sdk/client-secrets-manager'
import AwsSecretsManagerCredentialProvider from '../src/index.ts'
import { resolveSpec } from '../src/index.ts'

const mockSend = vi.fn()
const mockDestroy = vi.fn()

vi.mock('@aws-sdk/client-secrets-manager', () => {
  return {
    SecretsManagerClient: class MockSecretsManagerClient {
      send = mockSend
      destroy = mockDestroy
    },
    GetSecretValueCommand: vi.fn(),
    DescribeSecretCommand: vi.fn(),
    CreateSecretCommand: vi.fn(),
    PutSecretValueCommand: vi.fn(),
    DeleteSecretCommand: vi.fn(),
  }
})

function makeProvider(config: ConstructorParameters<typeof AwsSecretsManagerCredentialProvider>[1] = {}) {
  const ctx = new Context()
  mockSend.mockReset()
  mockDestroy.mockReset()
  return { provider: new AwsSecretsManagerCredentialProvider(ctx, config), send: mockSend }
}

describe('resolveSpec', () => {
  it('applies defaults', () => {
    expect(resolveSpec({})).toEqual({ secretPrefix: '/dsh/', secretFormat: 'json' })
  })

  it('keeps explicit values', () => {
    expect(resolveSpec({ secretPrefix: '/prod/', secretFormat: 'plain', region: 'us-west-2', profile: 'ops', jsonField: 'key' }))
      .toEqual({ secretPrefix: '/prod/', secretFormat: 'plain', region: 'us-west-2', profile: 'ops', jsonField: 'key' })
  })
})

describe('AwsSecretsManagerCredentialProvider', () => {
  it('resolves a plain secret', async () => {
    const { provider, send } = makeProvider({ secretFormat: 'plain' })
    send.mockResolvedValue({ SecretString: 'sk-plain' })
    const resolved = await provider.resolve(credentialRef('MY_KEY'))
    expect(resolved).toEqual({ value: 'sk-plain', source: 'aws-secrets-manager' })
    expect(send).toHaveBeenCalledWith(expect.any(GetSecretValueCommand))
  })

  it('constructs with explicit region and profile overrides', async () => {
    const { provider, send } = makeProvider({ region: 'us-west-2', profile: 'ops' })
    send.mockResolvedValue({ SecretString: '{"MY_KEY":"sk-json"}' })
    await expect(provider.resolve(credentialRef('MY_KEY'))).resolves.toEqual({
      value: 'sk-json',
      source: 'aws-secrets-manager',
    })
  })

  it('resolves a JSON secret using the ref name as the default field', async () => {
    const { provider, send } = makeProvider()
    send.mockResolvedValue({ SecretString: '{"MY_KEY":"sk-json"}' })
    const resolved = await provider.resolve(credentialRef('MY_KEY'))
    expect(resolved).toEqual({ value: 'sk-json', source: 'aws-secrets-manager' })
  })

  it('resolves a JSON secret using a configured jsonField', async () => {
    const { provider, send } = makeProvider({ jsonField: 'apiKey' })
    send.mockResolvedValue({ SecretString: '{"apiKey":"sk-custom"}' })
    const resolved = await provider.resolve(credentialRef('MY_KEY'))
    expect(resolved).toEqual({ value: 'sk-custom', source: 'aws-secrets-manager' })
  })

  it('returns undefined for a missing secret', async () => {
    const { provider, send } = makeProvider()
    send.mockRejectedValue({ name: 'ResourceNotFoundException' })
    await expect(provider.resolve(credentialRef('MISSING'))).resolves.toBeUndefined()
  })

  it('returns undefined for binary and empty secret payloads', async () => {
    const { provider, send } = makeProvider()
    send.mockResolvedValueOnce({ SecretString: undefined })
      .mockResolvedValueOnce({ SecretString: '' })
    await expect(provider.resolve(credentialRef('BINARY'))).resolves.toBeUndefined()
    await expect(provider.resolve(credentialRef('EMPTY'))).resolves.toBeUndefined()
  })

  it('rethrows non-not-found resolve and describe failures', async () => {
    const { provider, send } = makeProvider()
    const error = new Error('access denied')
    send.mockRejectedValueOnce(error)
    await expect(provider.resolve(credentialRef('DENIED'))).rejects.toBe(error)
    send.mockRejectedValueOnce(error)
    await expect(provider.describe(credentialRef('DENIED'))).rejects.toBe(error)
  })

  it('returns undefined for an empty JSON field', async () => {
    const { provider, send } = makeProvider()
    send.mockResolvedValue({ SecretString: '{"MY_KEY":""}' })
    await expect(provider.resolve(credentialRef('MY_KEY'))).resolves.toBeUndefined()
  })

  it('throws on invalid JSON', async () => {
    const { provider, send } = makeProvider()
    send.mockResolvedValue({ SecretString: 'not-json' })
    await expect(provider.resolve(credentialRef('MY_KEY'))).rejects.toThrow(/not valid JSON/)
  })

  it('throws on non-object JSON', async () => {
    const { provider, send } = makeProvider()
    send.mockResolvedValue({ SecretString: '["array"]' })
    await expect(provider.resolve(credentialRef('MY_KEY'))).rejects.toThrow(/must be a JSON object/)
  })

  it('describes a missing secret as unconfigured', async () => {
    const { provider, send } = makeProvider()
    send.mockRejectedValue({ name: 'ResourceNotFoundException' })
    await expect(provider.describe(credentialRef('MISSING'))).resolves.toEqual({ configured: false, writable: true })
  })

  it('describes an existing secret as configured', async () => {
    const { provider, send } = makeProvider()
    send.mockResolvedValue({})
    await expect(provider.describe(credentialRef('MY_KEY'))).resolves.toEqual({
      configured: true,
      source: 'aws-secrets-manager',
      writable: true,
    })
  })

  it('rejects an empty set', async () => {
    const { provider } = makeProvider()
    await expect(provider.set(credentialRef('MY_KEY'), '')).rejects.toThrow(/empty value cannot be stored/)
  })

  it('creates a secret when set finds none', async () => {
    const { provider, send } = makeProvider()
    send.mockRejectedValueOnce({ name: 'ResourceNotFoundException' })
    send.mockResolvedValueOnce({})
    await provider.set(credentialRef('MY_KEY'), 'sk-new')
    expect(send).toHaveBeenCalledWith(expect.any(PutSecretValueCommand))
    expect(send).toHaveBeenCalledWith(expect.any(CreateSecretCommand))
  })

  it('updates an existing secret on set', async () => {
    const { provider, send } = makeProvider()
    send.mockResolvedValue({})
    await provider.set(credentialRef('MY_KEY'), 'sk-updated')
    expect(send).toHaveBeenCalledWith(expect.any(PutSecretValueCommand))
    expect(send).not.toHaveBeenCalledWith(expect.any(CreateSecretCommand))
  })

  it('writes plain secret payloads', async () => {
    const { provider, send } = makeProvider({ secretFormat: 'plain' })
    send.mockResolvedValue({})
    await provider.set(credentialRef('MY_KEY'), 'sk-plain')
    expect(send).toHaveBeenCalledWith(expect.any(PutSecretValueCommand))
  })

  it('rethrows non-not-found set and unset failures', async () => {
    const { provider, send } = makeProvider()
    const error = new Error('access denied')
    send.mockRejectedValueOnce(error)
    await expect(provider.set(credentialRef('MY_KEY'), 'sk-denied')).rejects.toBe(error)
    send.mockRejectedValueOnce(error)
    await expect(provider.unset(credentialRef('MY_KEY'))).rejects.toBe(error)
  })

  it('deletes a secret on unset', async () => {
    const { provider, send } = makeProvider()
    send.mockResolvedValue({})
    await provider.unset(credentialRef('MY_KEY'))
    expect(send).toHaveBeenCalledWith(expect.any(DeleteSecretCommand))
  })

  it('ignores unset of a missing secret', async () => {
    const { provider, send } = makeProvider()
    send.mockRejectedValue({ name: 'ResourceNotFoundException' })
    await expect(provider.unset(credentialRef('MISSING'))).resolves.toBeUndefined()
  })

  it('destroys the client from the service disposer', () => {
    const { provider } = makeProvider()
    const disposer = provider[Service.init]().next().value
    if (typeof disposer !== 'function') throw new Error('provider did not yield a disposer')
    disposer()
    expect(mockDestroy).toHaveBeenCalledOnce()
  })
})
