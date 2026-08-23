import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { boot, healProfilesModuleFallback, loadProfile } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import { INSTALL_ANCHOR, materializeProfile, sanitizeAwsEnv } from './profile.ts'

describe('aws-headless assembled profile snapshot', () => {
  it('records the keyless provider and tool composition', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-aws-headless-snapshot-'))
    const restoreEnv = sanitizeAwsEnv(home)
    try {
      const profileDir = await materializeProfile(home)
      healProfilesModuleFallback(INSTALL_ANCHOR, home)
      const profile = loadProfile('dsh-snapshot', 'aws-headless', INSTALL_ANCHOR, home)
      const patches: PatchOptions[] = [
        ...profile.layers.flatMap(layer => layer.patches),
        ...profile.patches,
        { id: 'settings', config: { path: join(home, 'settings.yaml'), watch: false } },
        { id: 'session-telemetry-otel', disabled: true },
      ]
      const ctx = await boot('dsh-snapshot', join(profileDir, 'cordis.yml'), patches, (bootCtx) => {
        provideCmdline(bootCtx, { args: [], exit: () => {} })
      })
      try {
        const toolSummary = ctx.tools.schemas().map((schema) => {
          const parameters = schema.parameters as { properties?: Record<string, unknown>; required?: string[] }
          return {
            name: schema.name,
            properties: Object.keys(parameters.properties ?? {}).sort(),
            required: [...(parameters.required ?? [])].sort(),
          }
        }).sort((left, right) => left.name.localeCompare(right.name))
        expect({
          credentials: (ctx.get('credentials') as object).constructor.name,
          providers: ctx.llm.listProviders().map(provider => provider.id).sort(),
          tools: toolSummary,
        }).toMatchSnapshot()
      } finally {
        await ctx.fiber.dispose()
      }
    } finally {
      restoreEnv()
      await rm(home, { recursive: true, force: true })
    }
  }, 60_000)
})
