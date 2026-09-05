/** Browser contribution for the DSH 2API credential-management Settings tab. */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { TwoApiKeysSettingsTab } from './TwoApiKeysSettingsTab.tsx'
import type { TwoApiKeysSettingsTabInjected } from './TwoApiKeysSettingsTab.tsx'
import { en, zh, type TwoApiKeysLocaleKey } from './locales.ts'

export type { TwoApiKeysSettingsTabInjected, TwoApiKeysSettingsTabProps } from './TwoApiKeysSettingsTab.tsx'
export type { TwoApiKeyDefinition, TwoApiKeyId } from './keys.ts'
export { TWO_API_KEYS } from './keys.ts'
export type { TwoApiKeysLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 2API credential-management Settings copy. */
    'settings.twoApiKeys': TwoApiKeysLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.twoApiKeys'

/** Services required by the Settings tab registration. */
export const inject = ['slots', 'locale', 'connection']

/** Contribute the 2API key tab to the existing Plugins settings section. */
export function apply(ctx: ClientContext): void {
  const { api } = ctx.get('connection') as ConnectionHandle
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-2api-keys: dictionaries')

  const injected = (): TwoApiKeysSettingsTabInjected => ({ api })
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: '2api-keys',
    order: 20,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, TwoApiKeysSettingsTab))
}
