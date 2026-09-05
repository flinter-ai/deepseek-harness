/** Credential references owned by the 2API settings surface. */

import type { TwoApiKeysLocaleKey } from './locales.ts'

/** One provider key shown by the tab. */
export interface TwoApiKeyDefinition {
  /** Stable row identity. */
  readonly id: string
  /** Credential reference resolved by the DSH Host. */
  readonly ref: string
  /** Localized row title. */
  readonly title: TwoApiKeysLocaleKey
  /** Localized row description. */
  readonly description: TwoApiKeysLocaleKey
  /** Static, machine-local command the user can copy into Terminal. */
  readonly restartCommand: string
}

/**
 * The WorkBuddy adapter consumes `WORKBUDDY_API_KEY`; Gemini2API's main
 * `API_KEY` authenticates `/admin/*` too when `ADMIN_API_KEY` is left empty.
 */
export const TWO_API_KEYS = [
  {
    id: 'workbuddy',
    ref: 'WORKBUDDY_API_KEY',
    title: 'workbuddyTitle',
    description: 'workbuddyDescription',
    restartCommand: 'launchctl kickstart -k "gui/$(id -u)/com.workbuddy2api"',
  },
  {
    id: 'gemini2api',
    ref: 'API_KEY',
    title: 'geminiTitle',
    description: 'geminiDescription',
    restartCommand: 'launchctl kickstart -k "gui/$(id -u)/com.xwteam.gemini2api"',
  },
] as const satisfies readonly TwoApiKeyDefinition[]

/** Stable row-id union. */
export type TwoApiKeyId = (typeof TWO_API_KEYS)[number]['id']
