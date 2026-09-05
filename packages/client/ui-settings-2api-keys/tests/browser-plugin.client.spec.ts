// @vitest-environment jsdom

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject, NS } from '../src/client/index.ts'
import { TwoApiKeysSettingsTab } from '../src/client/TwoApiKeysSettingsTab.tsx'
import type { TwoApiKeysSettingsTabInjected } from '../src/client/TwoApiKeysSettingsTab.tsx'

afterEach(() => vi.restoreAllMocks())

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const api = {
    credentials: {
      describe: vi.fn(async () => ({ result: { ok: true as const, value: { credentials: {} } } })),
      set: vi.fn(async () => ({ result: { ok: true as const, value: {} } })),
      unset: vi.fn(async () => ({ result: { ok: true as const, value: {} } })),
    },
  }
  ctx.provide('connection', { api })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, api }
}

describe('ui-settings-2api-keys browser plugin', () => {
  it('declares only the services used by its Settings contribution', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('registers a localized tab lazily and passes only the credential API face', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.plugins.tab')[0]!
    expect(entry.component).toBe(TwoApiKeysSettingsTab)
    expect(entry.options).toMatchObject({ id: '2api-keys', order: 20 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('2API keys')
    expect((entry.inject as unknown as () => TwoApiKeysSettingsTabInjected)()).toEqual({ api: b.api })
    expect(b.api.credentials.describe).not.toHaveBeenCalled()

    await b.ctx.fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
  })
})
