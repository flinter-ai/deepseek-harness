/** Credential references owned by the local relay settings surface. */

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
  /** Optional machine-local key rotation command; never executed by the browser. */
  readonly rotateCommand?: string
}

/**
 * WorkBuddy consumes `WORKBUDDY_API_KEY`; Gemini2API consumes its main
 * `API_KEY`; zcode2api consumes its gateway `ZCODE_API_KEY`. The zcode
 * gateway key is intentionally separate from its admin password.
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
  {
    id: 'zcode2api',
    ref: 'ZCODE_API_KEY',
    title: 'zcodeTitle',
    description: 'zcodeDescription',
    restartCommand: 'launchctl kickstart -k "gui/$(id -u)/com.callingforhelp.zcode2api"',
    rotateCommand: 'cd "$HOME/zcode2api/.worktrees/native-kimi-dsh" && .venv/bin/python scripts/rotate_gateway_key.py --copy --restart',
  },
] as const satisfies readonly TwoApiKeyDefinition[]

/** Stable row-id union. */
export type TwoApiKeyId = (typeof TWO_API_KEYS)[number]['id']
