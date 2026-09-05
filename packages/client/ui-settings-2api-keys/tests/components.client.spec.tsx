// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TwoApiKeysSettingsTab } from '../src/client/TwoApiKeysSettingsTab.tsx'
import type {
  TwoApiKeysSettingsTabInjected,
  TwoApiKeysSettingsTabProps,
} from '../src/client/TwoApiKeysSettingsTab.tsx'
import { en, type TwoApiKeysLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: TwoApiKeysLocaleKey): string => en[key]) as TwoApiKeysSettingsTabProps['t']

type CredentialMap = Record<string, { configured: boolean; source?: string; writable: boolean }>

function response(credentials: CredentialMap) {
  return { result: { ok: true as const, value: { credentials } } }
}

function failure(message: string) {
  return { result: { ok: false as const, error: { code: 'internal', message } } }
}

function props(credentials: CredentialMap = {}) {
  const describe = vi.fn(async () => response({
    WORKBUDDY_API_KEY: { configured: false, writable: true },
    API_KEY: { configured: false, writable: true },
    ...credentials,
  }))
  const set = vi.fn(async () => ({ result: { ok: true as const, value: {} } }))
  const unset = vi.fn(async () => ({ result: { ok: true as const, value: {} } }))
  const injected: TwoApiKeysSettingsTabInjected = {
    api: { credentials: { describe, set, unset } } as never,
  }
  return { props: { ...injected, t } as TwoApiKeysSettingsTabProps, describe, set, unset }
}

describe('TwoApiKeysSettingsTab', () => {
  it('describes the two exact credential references and never retains a saved value', async () => {
    const harness = props()
    render(<TwoApiKeysSettingsTab {...harness.props} />)

    expect(screen.getByText(en.loading)).toBeTruthy()
    await screen.findByText(en.workbuddyTitle)
    expect(harness.describe).toHaveBeenCalledWith({ refs: ['WORKBUDDY_API_KEY', 'API_KEY'] })
    expect(screen.getByText('WORKBUDDY_API_KEY')).toBeTruthy()
    expect(screen.getByText('API_KEY')).toBeTruthy()
    expect(screen.getAllByText(en.notConfigured)).toHaveLength(2)
    expect(screen.getByText('launchctl kickstart -k "gui/$(id -u)/com.workbuddy2api"')).toBeTruthy()
    expect(screen.getByText('launchctl kickstart -k "gui/$(id -u)/com.xwteam.gemini2api"')).toBeTruthy()

    fireEvent.change(screen.getByLabelText(en.apiKey, { selector: '#api-key-2api-workbuddy' }), {
      target: { value: 'sk-workbuddy-test' },
    })
    const workbuddyCard = screen.getByText(en.workbuddyTitle).closest('li') as HTMLElement
    fireEvent.click(within(workbuddyCard).getByRole('button', { name: en.save }))

    await waitFor(() => {
      expect(harness.set).toHaveBeenCalledWith({ ref: 'WORKBUDDY_API_KEY', value: 'sk-workbuddy-test' })
    })
    expect(screen.queryByDisplayValue('sk-workbuddy-test')).toBeNull()
  })

  it('removes a configured writable key only after the inline confirmation', async () => {
    const harness = props({
      WORKBUDDY_API_KEY: { configured: true, source: 'file', writable: true },
    })
    render(<TwoApiKeysSettingsTab {...harness.props} />)
    await screen.findByText(en.workbuddyTitle)

    fireEvent.click(screen.getByRole('button', { name: en.remove }))
    expect(harness.unset).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.confirmRemove }))

    await waitFor(() => {
      expect(harness.unset).toHaveBeenCalledWith({ ref: 'WORKBUDDY_API_KEY' })
    })
  })

  it('keeps environment-sourced keys read-only', async () => {
    const harness = props({
      API_KEY: { configured: true, source: 'env', writable: false },
    })
    render(<TwoApiKeysSettingsTab {...harness.props} />)
    await screen.findByText(en.geminiTitle)

    expect(screen.getByLabelText(en.apiKey, { selector: '#api-key-2api-gemini2api' })).toHaveProperty('disabled', true)
    expect(screen.getByText(en.readOnly)).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.confirmRemove })).toBeNull()
  })

  it('shows a generic failure and retries the status read', async () => {
    const harness = props()
    harness.describe
      .mockImplementationOnce(async () => failure('private transport detail') as never)
      .mockImplementationOnce(async () => response({
        WORKBUDDY_API_KEY: { configured: false, writable: true },
        API_KEY: { configured: false, writable: true },
      }))
    render(<TwoApiKeysSettingsTab {...harness.props} />)

    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    expect(screen.queryByText('private transport detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(harness.describe).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(en.workbuddyTitle)).toBeTruthy()
  })

  it('does not submit blank or whitespace-only drafts', async () => {
    const harness = props()
    render(<TwoApiKeysSettingsTab {...harness.props} />)
    await screen.findByText(en.workbuddyTitle)

    const input = screen.getByLabelText(en.apiKey, { selector: '#api-key-2api-workbuddy' })
    fireEvent.change(input, { target: { value: '   ' } })
    const workbuddyCard = screen.getByText(en.workbuddyTitle).closest('li') as HTMLElement
    expect(within(workbuddyCard).getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    await act(async () => { await Promise.resolve() })
    expect(harness.set).not.toHaveBeenCalled()
  })
})
