import { describe, expect, it } from 'vitest'
import { isProviderError } from '../failure-classifier.mjs'

describe('failure-classifier', () => {
  it('retries on transport failures observed with gpt-5.6-luna', () => {
    expect(isProviderError('dsh: TRANSPORT: Stream ended without finish_reason')).toBe(true)
  })

  it('retries on generic transport and finish_reason errors', () => {
    expect(isProviderError('transport error while streaming')).toBe(true)
    expect(isProviderError('missing finish_reason in last chunk')).toBe(true)
  })

  it('retries on provider/quota/auth errors', () => {
    expect(isProviderError('429 Too Many Requests')).toBe(true)
    expect(isProviderError('404 model not found')).toBe(true)
    expect(isProviderError('unauthorized: invalid api key')).toBe(true)
    expect(isProviderError('insufficient balance / credit exhausted')).toBe(true)
    expect(isProviderError('quota exceeded')).toBe(true)
    expect(isProviderError('model not supported')).toBe(true)
    expect(isProviderError('invalid model')).toBe(true)
  })

  it('does NOT retry on NO_ADAPTER', () => {
    expect(isProviderError('dsh: NO_ADAPTER: no adapter registered for provider "opencode-go"')).toBe(false)
  })

  it('does NOT retry on local config errors', () => {
    expect(isProviderError('ENOENT: settings.yaml not found')).toBe(false)
    expect(isProviderError('syntax error near "providers"')).toBe(false)
  })
})
