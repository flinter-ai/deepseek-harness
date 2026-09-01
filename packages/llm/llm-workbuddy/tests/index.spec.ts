import { describe, expect, it } from 'vitest'
import { resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai'
import { apply as applyInvariant, name as invariantName } from '@deepseek-ai/dsh-llm-workbuddy/invariant'
import {
  buildWorkbuddyProfile, DEFAULT_API_KEY_ENV, DEFAULT_BASE_URL, DEFAULT_DISPLAY_NAME,
  WORKBUDDY_PROVIDER,
} from '@deepseek-ai/dsh-llm-workbuddy'
import {
  workbuddyCatalog, WORKBUDDY_MODELS, WORKBUDDY_REASONING_EFFORTS, WORKBUDDY_THINKING_CAPABLE,
} from '@deepseek-ai/dsh-llm-workbuddy'

describe('workbuddy catalog', () => {
  it('exposes the gateway model menu', () => {
    expect(WORKBUDDY_MODELS).toContain('deepseek-v4-flash')
    expect(WORKBUDDY_MODELS).toContain('kimi-k3-1')
    expect(WORKBUDDY_MODELS).toContain('glm-5.2')
  })

  it('pins every gateway model to a profile', () => {
    const profiles = workbuddyCatalog()
    expect(profiles).toHaveLength(WORKBUDDY_MODELS.length)
    for (const model of profiles) {
      expect(WORKBUDDY_MODELS).toContain(model.id)
      if (WORKBUDDY_THINKING_CAPABLE.has(model.id)) {
        expect(model.reasoningEfforts).toEqual(WORKBUDDY_REASONING_EFFORTS)
      } else {
        expect(model.reasoningEfforts).toBe(false)
      }
    }
  })

  it('maps off to the explicit none wire value', () => {
    expect(WORKBUDDY_REASONING_EFFORTS.off).toBe('none')
    expect(WORKBUDDY_REASONING_EFFORTS.max).toBe('max')
  })
})

describe('workbuddy config', () => {
  it('defaults to the loopback route and full catalog', () => {
    const profile = buildWorkbuddyProfile({})
    expect(profile.api).toBe('openai-completions')
    expect(profile.baseURL).toBe(DEFAULT_BASE_URL)
    expect(profile.apiKeyEnv).toBe(DEFAULT_API_KEY_ENV)
    expect(profile.displayName).toBe(DEFAULT_DISPLAY_NAME)
    expect(profile.models).toEqual(workbuddyCatalog())
  })

  it('preserves explicit sections', () => {
    const profile = buildWorkbuddyProfile({
      baseURL: 'http://127.0.0.1:9000/v1',
      apiKeyEnv: 'CUSTOM_WORKBUDDY_KEY',
      displayName: 'Local Workbuddy',
      models: [{ id: 'deepseek-v4-flash' }],
    })
    expect(profile.baseURL).toBe('http://127.0.0.1:9000/v1')
    expect(profile.apiKeyEnv).toBe('CUSTOM_WORKBUDDY_KEY')
    expect(profile.displayName).toBe('Local Workbuddy')
    expect(profile.models).toEqual([{ id: 'deepseek-v4-flash' }])
  })

  it('resolves into a pi-ai provider route', () => {
    const resolved = resolveProfiles({ [WORKBUDDY_PROVIDER]: buildWorkbuddyProfile({}) })
    const route = resolved.get(WORKBUDDY_PROVIDER)
    expect(route).toBeDefined()
    expect(route!.displayName).toBe(DEFAULT_DISPLAY_NAME)
    expect(route!.piProvider).toBeDefined()
  })
})

describe('workbuddy invariant companion', () => {
  it('registers the package and returns a disposer', async () => {
    const registered: string[] = []
    const ctx = {
      invariants: { register: (name: string) => { registered.push(name); return () => {} } },
    } as never
    const dispose = await applyInvariant(ctx)
    expect(registered).toContain('@deepseek-ai/dsh-llm-workbuddy')
    expect(typeof dispose).toBe('function')
    dispose()
  })

  it('names the companion plugin correctly', () => {
    expect(invariantName).toBe('llm-workbuddy-invariant')
  })
})
