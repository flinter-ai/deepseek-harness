import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { AwsSecretsManagerCredentialProvider, parseSecretValue } from '../src/index.ts'

const KEY = credentialRef('AWS_TEST_KEY')

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

function provider(
  read: (secretId: string) => Promise<{ secretString?: string; secretBinary?: unknown }>,
  refreshMs = 0,
) {
  const ctx = new Context()
  return {
    ctx,
    provider: new AwsSecretsManagerCredentialProvider(ctx, { secretId: 'dsh/test', refreshMs }, read),
  }
}

describe('parseSecretValue', () => {
  it('accepts a JSON credential map without changing values', () => {
    expect(parseSecretValue({ secretString: JSON.stringify({ AWS_TEST_KEY: 'value' }) })).toEqual(
      new Map([['AWS_TEST_KEY', 'value']]),
    )
  })

  it.each([
    [{}, 'no non-empty SecretString'],
    [{ secretString: '' }, 'no non-empty SecretString'],
    [{ secretString: 'not-json' }, 'not valid JSON'],
    [{ secretString: '[]' }, 'must be a JSON object'],
    [{ secretString: JSON.stringify({ 'bad-name': 'value' }) }, 'invalid credential reference'],
    [{ secretString: JSON.stringify({ AWS_TEST_KEY: '' }) }, 'must have a non-empty string value'],
    [{ secretString: JSON.stringify({ AWS_TEST_KEY: 'value' }), secretBinary: new Uint8Array([1]) }, 'SecretBinary is unsupported'],
  ])('rejects unsafe secret payloads', (payload, message) => {
    expect(() => parseSecretValue(payload)).toThrow(message)
  })
})

describe('AwsSecretsManagerCredentialProvider', () => {
  it('uses the inherited environment before calling Secrets Manager', async () => {
    vi.stubEnv('AWS_TEST_KEY', 'from-env')
    const read = vi.fn(async () => ({ secretString: JSON.stringify({ AWS_TEST_KEY: 'from-aws' }) }))
    const { provider } = providerFactory(read)
    await expect(provider.resolve(KEY)).resolves.toEqual({ value: 'from-env', source: 'env' })
    expect(read).not.toHaveBeenCalled()
    await expect(provider.describe(KEY)).resolves.toEqual({ configured: true, source: 'env', writable: false })
  })

  it('resolves and describes a remote value without exposing it in describe', async () => {
    const read = vi.fn(async () => ({ secretString: JSON.stringify({ AWS_TEST_KEY: 'from-aws' }) }))
    const { provider } = providerFactory(read)
    await expect(provider.resolve(KEY)).resolves.toEqual({ value: 'from-aws', source: 'aws-secrets-manager' })
    await expect(provider.describe(KEY)).resolves.toEqual({ configured: true, source: 'aws-secrets-manager', writable: false })
  })

  it('coalesces and refreshes remote reads according to refreshMs', async () => {
    vi.useFakeTimers()
    const read = vi.fn(async () => ({ secretString: JSON.stringify({ AWS_TEST_KEY: `value-${read.mock.calls.length}` }) }))
    const { provider } = providerFactory(read, 1000)
    await expect(provider.resolve(KEY)).resolves.toMatchObject({ value: 'value-1' })
    await expect(provider.resolve(KEY)).resolves.toMatchObject({ value: 'value-1' })
    expect(read).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1001)
    await expect(provider.resolve(KEY)).resolves.toMatchObject({ value: 'value-2' })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('fails closed for remote read failures and refuses all writes', async () => {
    const { provider } = providerFactory(async () => { throw { name: 'AccessDeniedException', message: 'do not echo' } })
    await expect(provider.resolve(KEY)).rejects.toThrow('AccessDeniedException')
    await expect(provider.set(KEY, 'value')).rejects.toThrow('read-only AWS provider')
    await expect(provider.unset(KEY)).rejects.toThrow('read-only AWS provider')
    await expect(provider.modifyRecord('owner/id' as never, async () => undefined)).rejects.toThrow('read-only AWS provider')
  })

  it('returns an unconfigured, non-writable view for an absent key', async () => {
    const { provider } = providerFactory(async () => ({ secretString: JSON.stringify({ OTHER_KEY: 'value' }) }))
    await expect(provider.describe(KEY)).resolves.toEqual({ configured: false, writable: false })
  })
})

function providerFactory(
  read: (secretId: string) => Promise<{ secretString?: string; secretBinary?: unknown }>,
  refreshMs = 0,
) {
  return provider(read, refreshMs)
}
