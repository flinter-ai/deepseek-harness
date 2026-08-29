/**
 * FLINTER's Phase 1 profile layer over the pinned DeepSeek Harness alpha.
 *
 * This module owns route names, credential references, and fresh-session
 * selection. Transport, provider construction, credentials, sessions, and
 * tools remain DSH responsibilities. A session captures the selected route
 * once; a later UTC boundary affects only a new session.
 */

export const FLINTER_CREDENTIAL_REFS = Object.freeze({
  arkAgentPlan: 'ARK_PLAN_API_KEY',
  modelflare: 'MODELFLARE_API_KEY',
  gmiServing: 'GMI_SERVING_API_KEY',
  deepseekOfficial: 'DEEPSEEK_API_KEY',
} as const)

export const FLINTER_AWS_SECRET_NAMES = Object.freeze({
  arkAgentPlan: 'flinter/dsh-ark-agent-plan',
  modelflare: 'flinter/dsh-modelflare',
  gmiServing: 'flinter/dsh-gmi-serving',
  deepseekOfficial: 'flinter/dsh-deepseek-official',
} as const)

/** Values verified against the alpha's llm-pi-ai config schema. */
export const PI_AI_DEFAULTS = Object.freeze({
  contextWindow: 262_144,
  maxTokens: 32_768,
} as const)

export const FLINTER_DEFAULT_PROVIDER = 'ark-agent-plan' as const
export const FLINTER_ROTATION_PROVIDER = 'modelflare' as const

export type FlinterProviderId = 'ark-agent-plan' | 'modelflare' | 'gmi-serving'

export interface FlinterProviderEndpointConfig {
  arkAgentPlan: string
  modelflare: string
  gmiServing: string
}

export interface FlinterModelProfile {
  id: string
  name: string
  contextWindow: number
  maxTokens: number
}

export interface FlinterProviderProfile {
  displayName: string
  apiKeyEnv: string
  api: 'openai-completions'
  baseURL: string
  defaultContextWindow: number
  defaultMaxTokens: number
  models: [FlinterModelProfile]
}

export interface FlinterProviderSettings {
  providers: Record<FlinterProviderId, FlinterProviderProfile>
}

export interface FlinterSessionRoute {
  provider: FlinterProviderId
  model: string
}

function profile(
  displayName: string,
  apiKeyEnv: string,
  baseURL: string,
  model: string,
): FlinterProviderProfile {
  return {
    displayName,
    apiKeyEnv,
    api: 'openai-completions',
    baseURL,
    defaultContextWindow: PI_AI_DEFAULTS.contextWindow,
    defaultMaxTokens: PI_AI_DEFAULTS.maxTokens,
    models: [{
      id: model,
      name: model,
      contextWindow: PI_AI_DEFAULTS.contextWindow,
      maxTokens: PI_AI_DEFAULTS.maxTokens,
    }],
  }
}

/** Build the settings section consumed by @deepseek-ai/dsh-llm-pi-ai. */
export function buildFlinterProviderSettings(
  endpoints: FlinterProviderEndpointConfig,
): FlinterProviderSettings {
  return {
    providers: {
      'ark-agent-plan': profile(
        'ARK Agent Plan',
        FLINTER_CREDENTIAL_REFS.arkAgentPlan,
        endpoints.arkAgentPlan,
        'ark-code-latest',
      ),
      modelflare: profile(
        'Modelflare',
        FLINTER_CREDENTIAL_REFS.modelflare,
        endpoints.modelflare,
        'gpt-5.6-sol',
      ),
      'gmi-serving': profile(
        'GMI Serving',
        FLINTER_CREDENTIAL_REFS.gmiServing,
        endpoints.gmiServing,
        'deepseek-ai/DeepSeek-V4-Flash-0731',
      ),
    },
  }
}

/**
 * Select the route for a fresh session. The production clock is UTC; tests
 * pass an explicit Date so the boundary is deterministic and does not require
 * a global clock mock.
 */
export function freshSessionProvider(now: Date, fallback = FLINTER_DEFAULT_PROVIDER): FlinterProviderId {
  const hour = now.getUTCHours()
  if (hour >= 16 && hour < 24) return FLINTER_DEFAULT_PROVIDER
  if (fallback === FLINTER_DEFAULT_PROVIDER) return FLINTER_ROTATION_PROVIDER
  return fallback
}

/** Capture provider and model together so an existing session never rotates. */
export function bindFreshSession(
  now: Date,
  endpoints: FlinterProviderEndpointConfig,
): FlinterSessionRoute {
  const provider = freshSessionProvider(now)
  return {
    provider,
    model: buildFlinterProviderSettings(endpoints).providers[provider].models[0].id,
  }
}

/** Direct DeepSeek is intentionally a separate dsh-llm-deepseek route. */
export const DIRECT_DEEPSEEK_ROUTE = Object.freeze({
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  apiKeyEnv: FLINTER_CREDENTIAL_REFS.deepseekOfficial,
} as const)
