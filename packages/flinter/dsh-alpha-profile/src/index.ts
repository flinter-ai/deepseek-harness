/**
 * FLINTER's Phase 1 profile layer over the pinned DeepSeek Harness alpha.
 *
 * This module owns route names, credential references, and fresh-session
 * selection. Transport, provider construction, credentials, sessions, and
 * tools remain DSH responsibilities. A session captures the selected route
 * once; a later UTC boundary affects only a new session.
 */

import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'

export * from './worker.ts'
export * from './attempt.ts'
export * from './lifecycle.ts'

/** Environment-variable references used by the supported FLINTER routes. */
export const FLINTER_CREDENTIAL_REFS = Object.freeze({
  arkAgentPlan: 'ARK_PLAN_API_KEY',
  modelflare: 'MODELFLARE_API_KEY',
  gmiServing: 'GMI_SERVING_API_KEY',
  deepseekOfficial: 'DEEPSEEK_API_KEY',
} as const)

/** AWS Secrets Manager names corresponding to the supported route references. */
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

/**
 * Model-level capacities reported by the preserved FLINTER deployment line.
 * These are explicit profile inputs; they are not live-provider validation.
 */
export const FLINTER_MODEL_CAPACITIES = Object.freeze({
  arkCodeLatest: { contextWindow: 1_048_576, maxTokens: 131_072 },
  modelflareGpt56Sol: { contextWindow: 1_000_000 },
  gmiDeepSeekV4Flash: { contextWindow: 1_000_000, maxTokens: 384_000 },
} as const)

/** The selectable reasoning ids accepted by the alpha pi-ai catalog seam. */
export type FlinterReasoningEffort = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Map a user-facing level to the provider's wire spelling. */
export type FlinterReasoningEfforts = Partial<Record<FlinterReasoningEffort, string | null>>

/**
 * Levels currently verified for both ARK and Modelflare in this migration.
 *
 * `off: null` is required by the alpha model-map validator even when a
 * deployment advertises only the verified `high` wire value. Additional
 * user-selectable levels remain available through the explicit per-model
 * `reasoningEfforts` option below; this default does not claim live-provider
 * support for them.
 */
export const FLINTER_DEFAULT_REASONING_EFFORTS: FlinterReasoningEfforts = Object.freeze({
  off: null,
  high: 'high',
})

/** Provider selected during the UTC 16:00–24:00 fresh-session window. */
export const FLINTER_DEFAULT_PROVIDER = 'ark-agent-plan' as const
/** Provider selected outside the default provider's fresh-session window. */
export const FLINTER_ROTATION_PROVIDER = 'modelflare' as const

/** Provider route identifiers owned by the FLINTER profile. */
export type FlinterProviderId = 'ark-agent-plan' | 'modelflare' | 'gmi-serving'

/** Endpoint values required to construct the three configurable provider routes. */
export interface FlinterProviderEndpointConfig {
  arkAgentPlan: string
  modelflare: string
  gmiServing: string
}

/** Optional per-route overrides for the user-visible reasoning menu. */
export interface FlinterProviderSettingsOptions {
  /**
   * Optional per-model reasoning menu. Omitted routes retain the verified
   * `high` compatibility default; an explicit map lets a deployment expose
   * only the levels its endpoint has actually confirmed.
   */
  reasoningEfforts?: Partial<Record<FlinterProviderId, FlinterReasoningEfforts | false>>
}

/** Model identity and capacity values exposed in a provider profile. */
export interface FlinterModelProfile {
  id: string
  name: string
  contextWindow: number
  maxTokens?: number
  reasoningEfforts?: FlinterReasoningEfforts | false
}

/** One OpenAI-compatible provider route in the alpha settings schema. */
export interface FlinterProviderProfile {
  displayName: string
  apiKeyEnv: string
  api: 'openai-completions'
  baseURL: string
  defaultContextWindow: number
  defaultMaxTokens: number
  models: [FlinterModelProfile]
}

/** Complete provider settings section emitted by this profile layer. */
export interface FlinterProviderSettings {
  providers: Record<FlinterProviderId, FlinterProviderProfile>
}

/** Provider/model pair captured when a fresh DSH session is created. */
export interface FlinterSessionRoute {
  provider: FlinterProviderId
  model: string
}

function profile(
  displayName: string,
  apiKeyEnv: string,
  baseURL: string,
  model: string,
  capacity: { contextWindow: number; maxTokens?: number },
  reasoningEfforts?: FlinterReasoningEfforts | false,
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
      contextWindow: capacity.contextWindow,
      ...capacity.maxTokens === undefined ? {} : { maxTokens: capacity.maxTokens },
      ...reasoningEfforts === undefined
        ? {}
        : { reasoningEfforts: reasoningEfforts === false ? false : { ...reasoningEfforts } },
    }],
  }
}

/**
 * Build the settings section consumed by @deepseek-ai/dsh-llm-pi-ai.
 * @param endpoints - OpenAI-compatible endpoint URLs for each route.
 * @param options - Optional per-route reasoning-menu overrides.
 * @returns The alpha-compatible provider settings section.
 */
export function buildFlinterProviderSettings(
  endpoints: FlinterProviderEndpointConfig,
  options: FlinterProviderSettingsOptions = {},
): FlinterProviderSettings {
  const reasoningEfforts = options.reasoningEfforts ?? {}
  return {
    providers: {
      'ark-agent-plan': profile(
        'ARK Agent Plan',
        FLINTER_CREDENTIAL_REFS.arkAgentPlan,
        endpoints.arkAgentPlan,
        'ark-code-latest',
        FLINTER_MODEL_CAPACITIES.arkCodeLatest,
        reasoningEfforts['ark-agent-plan'] ?? FLINTER_DEFAULT_REASONING_EFFORTS,
      ),
      modelflare: profile(
        'Modelflare',
        FLINTER_CREDENTIAL_REFS.modelflare,
        endpoints.modelflare,
        'gpt-5.6-sol',
        FLINTER_MODEL_CAPACITIES.modelflareGpt56Sol,
        reasoningEfforts.modelflare ?? FLINTER_DEFAULT_REASONING_EFFORTS,
      ),
      'gmi-serving': profile(
        'GMI Serving',
        FLINTER_CREDENTIAL_REFS.gmiServing,
        endpoints.gmiServing,
        'deepseek-ai/DeepSeek-V4-Flash-0731',
        FLINTER_MODEL_CAPACITIES.gmiDeepSeekV4Flash,
        reasoningEfforts['gmi-serving'],
      ),
    },
  }
}

/**
 * Select the route for a fresh session. The production clock is UTC; tests
 * pass an explicit Date so the boundary is deterministic and does not require
 * a global clock mock.
 * @param now - UTC timestamp used to select the fresh-session route.
 * @param fallback - Route to retain when the clock is outside the default window.
 * @returns The provider route selected for a new session.
 */
export function freshSessionProvider(
  now: Date,
  fallback: FlinterProviderId = FLINTER_DEFAULT_PROVIDER,
): FlinterProviderId {
  const hour = now.getUTCHours()
  if (hour >= 16 && hour < 24) return FLINTER_DEFAULT_PROVIDER
  if (fallback === FLINTER_DEFAULT_PROVIDER) return FLINTER_ROTATION_PROVIDER
  return fallback
}

/**
 * Capture provider and model together so an existing session never rotates.
 * @param now - UTC timestamp used for fresh-session selection.
 * @param endpoints - Endpoint URLs used to resolve the selected model id.
 * @returns The provider/model route captured by the new session.
 */
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

/** The native DSH event types consumed by the Phase 1 FLINTER seam. */
export const FLINTER_NATIVE_EVENT_TYPES = Object.freeze([
  'turn/start',
  'step/start',
  'request/header',
  'request/context',
  'user/message',
  'assistant/chunk',
  'assistant/message',
  'tool/call',
  'tool/result',
  'step/end',
  'turn/end',
] as const)

/** One lossless item exposed to a future FLINTER trace consumer. */
export type FlinterNativeSessionItem =
  | Readonly<{ kind: 'session'; header: SessionHeader }>
  | Readonly<{ kind: 'event'; event: SessionEvent }>

/** Native DSH session data as consumed by FLINTER, without a parallel codec. */
export interface FlinterNativeSessionEvents {
  readonly session: SessionHeader
  readonly events: readonly SessionEvent[]
  readonly items: readonly FlinterNativeSessionItem[]
}

/**
 * Consume the canonical DSH header and event sequence without re-encoding it.
 * Unknown/plugin event types remain in `events` and `items` losslessly; the
 * consumer does not infer scientific meaning or create synthetic records.
 */
export function consumeFlinterNativeSessionEvents(
  session: SessionHeader,
  events: readonly SessionEvent[],
): FlinterNativeSessionEvents {
  const items: FlinterNativeSessionItem[] = [
    Object.freeze({ kind: 'session', header: session }),
    ...events.map(event => Object.freeze({ kind: 'event', event })),
  ]
  return Object.freeze({
    session,
    events,
    items: Object.freeze(items),
  })
}

/**
 * Credential backend selected by a profile. Both backends serve the same
 * DSH credential-reference seam; only the value source changes.
 */
export type FlinterCredentialBackend = 'local' | 'aws-secrets-manager'

/** Public profile names used by the alpha migration. */
export type FlinterProfileName = 'tod' | 'aws-worker'

/** A serializable Cordis patch row used by the AWS profile overlay. */
export type FlinterProfilePatch =
  | Readonly<{ id: 'credentials'; disabled: true }>
  | Readonly<{
    insert: readonly [{
      readonly id: 'credentials-aws-secrets-manager'
      readonly name: '@deepseek-ai/dsh-credentials-aws-secrets-manager'
      readonly config: Readonly<{
        readonly secretNames: Readonly<Record<string, string>>
        readonly secretFormat: 'json'
        readonly allowWrites: false
      }>
    }]
  }>

/** One public profile composition over the single DSH alpha installation. */
export interface FlinterProfileComposition {
  readonly name: FlinterProfileName
  readonly bundles: readonly ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless']
  readonly credentialBackend: FlinterCredentialBackend
  readonly credentialPackage:
    | '@deepseek-ai/dsh-credentials-local'
    | '@deepseek-ai/dsh-credentials-aws-secrets-manager'
  /** Empty for local; the AWS overlay replaces the base credential row. */
  readonly patches: readonly FlinterProfilePatch[]
}

/**
 * Build the public profile composition for one execution environment.
 *
 * This returns metadata only. It does not boot DSH, contact a provider, read
 * AWS, or contain a credential value. The AWS profile remains one thin patch
 * over the same base/headless DSH bundles used by local `tod`.
 */
export function buildFlinterProfileComposition(
  name: FlinterProfileName,
): FlinterProfileComposition {
  const bundles: FlinterProfileComposition['bundles'] = [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-headless',
  ]
  if (name === 'tod') {
    return Object.freeze({
      name,
      bundles,
      credentialBackend: 'local',
      credentialPackage: '@deepseek-ai/dsh-credentials-local',
      patches: Object.freeze([]),
    })
  }
  const patches: FlinterProfilePatch[] = [
    Object.freeze({ id: 'credentials', disabled: true }),
    Object.freeze({
      insert: [Object.freeze({
        id: 'credentials-aws-secrets-manager',
        name: '@deepseek-ai/dsh-credentials-aws-secrets-manager',
        config: Object.freeze({
          secretNames: FLINTER_AWS_SECRET_NAMES,
          secretFormat: 'json',
          allowWrites: false,
        }),
      })] as const,
    }),
  ]
  return Object.freeze({
    name,
    bundles,
    credentialBackend: 'aws-secrets-manager',
    credentialPackage: '@deepseek-ai/dsh-credentials-aws-secrets-manager',
    patches: Object.freeze(patches),
  })
}
