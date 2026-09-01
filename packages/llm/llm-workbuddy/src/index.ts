import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai/profile'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai/profile'
import {
  buildWorkbuddyProfile, Config, DEFAULT_DISPLAY_NAME, WORKBUDDY_PROVIDER,
} from './config.ts'
import type { WorkbuddyConfig } from './config.ts'

export {
  Config, buildWorkbuddyProfile, WORKBUDDY_PROVIDER,
  DEFAULT_API_KEY_ENV, DEFAULT_BASE_URL, DEFAULT_DISPLAY_NAME,
} from './config.ts'
export type { WorkbuddyConfig } from './config.ts'
export {
  workbuddyCatalog, WORKBUDDY_MODELS, WORKBUDDY_REASONING_EFFORTS, WORKBUDDY_THINKING_CAPABLE,
} from './catalog.ts'

export const name = 'llm-workbuddy'
export const inject = ['llm']
const NS = settingsNamespace('llm-workbuddy')

function assertServiceable(config: WorkbuddyConfig): void {
  resolveProfiles({ [WORKBUDDY_PROVIDER]: buildWorkbuddyProfile(config) })
}

export function apply(ctx: Context, config: WorkbuddyConfig): void {
  let current: () => WorkbuddyConfig = () => config
  let lastRaw: WorkbuddyConfig | undefined
  let memoized: ReadonlyMap<string, ResolvedPiAiProviderProfile> | undefined
  const profiles = (): ReadonlyMap<string, ResolvedPiAiProviderProfile> => {
    const raw = current()
    if (raw === lastRaw && memoized !== undefined) return memoized
    const next = resolveProfiles({ [WORKBUDDY_PROVIDER]: buildWorkbuddyProfile(raw) })
    lastRaw = raw
    memoized = next
    return next
  }
  profiles()

  const resolveApiKey = async (
    provider: string,
    profile: ResolvedPiAiProviderProfile,
  ): Promise<string | undefined> => {
    const ref = profile.apiKeyEnv
    if (ref === undefined) return undefined
    const credentials = ctx.get('credentials')
    const hit = credentials !== undefined
      ? (await credentials.resolve(ref))?.value
      : launchEnvironmentOf(ctx).get(ref)?.value
    if (hit !== undefined && hit.length > 0) return assertUsableApiKey(hit, 'llm-workbuddy', ref)
    throw new LlmError(
      'llm-workbuddy: no credential for provider route "' + provider + '"; resolve ' + ref
      + ' through the credentials service or export it',
      'MISSING_CREDENTIAL',
    )
  }

  const adapter = new PiAiAdapter({
    profiles,
    resolveApiKey,
    resolveAttachments: () => ctx.get('attachments'),
    onReplayDegrade: ({ provider, model, reason }) => {
      ctx.logger.warn(
        'llm-workbuddy: unusable replay state on assistant history for route "'
        + provider + '/' + model + '"; sending that message as provider-neutral content (' + reason + ')',
      )
    },
  })

  ctx.llm.registerConfigurableProviders([{
    provider: WORKBUDDY_PROVIDER,
    displayName: DEFAULT_DISPLAY_NAME,
    settingsNs: NS,
    settingsPath: [],
  } satisfies LlmConfigurableProvider])
  ctx.llm.registerAdapter([WORKBUDDY_PROVIDER], adapter)
  installSettingsSection(ctx, NS, Config, config, {
    validate: assertServiceable,
    setSource: (source) => { current = source },
    onChange: () => {},
  })
}
