/** Browser settings tab for the two local 2API credential references. */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type {
  CredentialView,
  IApiClient,
} from '@deepseek-ai/dsh-client-connection/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { TWO_API_KEYS, type TwoApiKeyDefinition, type TwoApiKeyId } from './keys.ts'
import css from './TwoApiKeysSettingsTab.module.css'

/** Services supplied by the registration site. */
export interface TwoApiKeysSettingsTabInjected {
  /** Credential-only wire face; values are sent only in set requests. */
  api: Pick<IApiClient, 'credentials'>
}

/** Full props assembled by the settings slot renderer. */
export type TwoApiKeysSettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.twoApiKeys'>
  & InjectFace<TwoApiKeysSettingsTabInjected>

type LoadState = 'loading' | 'ready' | 'error'
type Views = Record<TwoApiKeyId, CredentialView>

const EMPTY_VIEW: CredentialView = { configured: false, writable: true }
const KEY_VALUE = /^[\x21-\x7E]+$/

function emptyViews(): Views {
  return Object.fromEntries(TWO_API_KEYS.map(key => [key.id, EMPTY_VIEW])) as Views
}

function statusText(view: CredentialView, t: TwoApiKeysSettingsTabProps['t']): string {
  if (!view.configured) return t('notConfigured')
  return view.source === undefined ? t('configured') : `${t('configured')} · ${view.source}`
}

function validKey(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length > 0 && KEY_VALUE.test(trimmed)
}

interface KeyCardProps {
  definition: TwoApiKeyDefinition
  view: CredentialView
  draft: string
  confirmingRemoval: boolean
  busy: boolean
  t: TwoApiKeysSettingsTabProps['t']
  onDraft: (value: string) => void
  onSave: () => void
  onRequestRemoval: () => void
  onConfirmRemoval: () => void
  onCancelRemoval: () => void
}

/** A visible, copyable restart instruction; the browser never executes it. */
function RestartCommand({ command, t, id }: {
  command: string
  t: TwoApiKeysSettingsTabProps['t']
  id: string
}): ReactNode {
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    /* v8 ignore next -- browser hosts expose the Clipboard API; the command
       remains visible when a host policy refuses clipboard access. */
    if (typeof navigator.clipboard?.writeText !== 'function') return
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
    } catch {
      // Do not claim success when the browser denies clipboard access.
    }
  }

  return (
    <div className={css.restart} data-2api-restart-command={id}>
      <div className={css.restartHeader}>
        <span className={css.restartLabel}>{t('restartCommand')}</span>
        <button type="button" className={css.copyButton} onClick={() => { void copy() }}>
          {copied ? t('copied') : t('copyCommand')}
        </button>
      </div>
      <pre className={css.code}><code>{command}</code></pre>
      <p className={css.restartHint}>{t('restartHint')}</p>
    </div>
  )
}

/** One write-only credential editor. */
function KeyCard(props: KeyCardProps): ReactNode {
  const { definition, view, t } = props
  const disabled = props.busy || view.writable === false
  const canSave = !disabled && validKey(props.draft)
  const canRemove = view.configured && view.writable && !props.busy
  return (
    <li className={css.card} data-2api-key={definition.id}>
      <div className={css.cardHeader}>
        <div>
          <h3>{t(definition.title)}</h3>
          <p>{t(definition.description)}</p>
        </div>
        <span className={css.statusTag} data-configured={view.configured ? 'true' : 'false'}>
          {statusText(view, t)}
        </span>
      </div>
      <dl className={css.details}>
        <div>
          <dt>{t('reference')}</dt>
          <dd>{definition.ref}</dd>
        </div>
        {view.configured && view.source !== undefined ? (
          <div>
            <dt>{t('source')}</dt>
            <dd>{view.source}</dd>
          </div>
        ) : null}
      </dl>
      <div className={css.body}>
        {view.writable === false ? <p className={css.readOnly}>{t('readOnly')}</p> : null}
        <div className={css.field}>
          <label className={css.label} htmlFor={`api-key-2api-${definition.id}`}>{t('apiKey')}</label>
          <input
            id={`api-key-2api-${definition.id}`}
            className={css.input}
            type="password"
            autoComplete="off"
            placeholder={t('replacePlaceholder')}
            value={props.draft}
            disabled={disabled}
            onChange={(event) => { props.onDraft(event.currentTarget.value) }}
          />
          <p className={css.hint}>{validKey(props.draft) || props.draft.length === 0 ? t('apiKeyHint') : t('invalidKey')}</p>
        </div>
        <div className={css.actions}>
          {props.confirmingRemoval ? (
            <>
              <button type="button" className={css.quietButton} disabled={props.busy} onClick={props.onCancelRemoval}>
                {t('cancel')}
              </button>
              <button type="button" className={css.dangerButton} disabled={!canRemove} onClick={props.onConfirmRemoval}>
                {t('confirmRemove')}
              </button>
            </>
          ) : (
            <>
              {view.configured ? (
                <button type="button" className={css.dangerButton} disabled={!canRemove} onClick={props.onRequestRemoval}>
                  {t('remove')}
                </button>
              ) : null}
              <button type="button" className={css.button} disabled={!canSave} onClick={props.onSave}>
                {t(props.busy ? 'saving' : 'save')}
              </button>
            </>
          )}
        </div>
        <RestartCommand command={definition.restartCommand} id={definition.id} t={t} />
      </div>
    </li>
  )
}

/** Render the 2API key management tab. */
export function TwoApiKeysSettingsTab({ api, t }: TwoApiKeysSettingsTabProps): ReactNode {
  const [state, setState] = useState<LoadState>('loading')
  const [views, setViews] = useState<Views>(emptyViews)
  const [drafts, setDrafts] = useState<Record<TwoApiKeyId, string>>({ workbuddy: '', gemini2api: '' })
  const [busyKey, setBusyKey] = useState<TwoApiKeyId | undefined>(undefined)
  const [confirmingRemoval, setConfirmingRemoval] = useState<TwoApiKeyId | undefined>(undefined)
  const [message, setMessage] = useState<{ kind: 'notice' | 'error'; text: string } | undefined>(undefined)

  const refresh = useCallback(async (): Promise<void> => {
    setState('loading')
    try {
      const response = await api.credentials.describe({ refs: TWO_API_KEYS.map(key => key.ref) })
      if (!response.result.ok) throw new Error(response.result.error.message)
      const described = response.result.value.credentials
      setViews(Object.fromEntries(
        TWO_API_KEYS.map(key => [key.id, described[key.ref] ?? EMPTY_VIEW]),
      ) as Views)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [api])

  useEffect(() => { void refresh() }, [refresh])

  const updateDraft = (id: TwoApiKeyId, value: string): void => {
    setMessage(undefined)
    setDrafts(current => ({ ...current, [id]: value }))
  }

  const save = async (definition: TwoApiKeyDefinition): Promise<void> => {
    const value = drafts[definition.id as TwoApiKeyId].trim()
    if (!validKey(value)) return
    setBusyKey(definition.id as TwoApiKeyId)
    setConfirmingRemoval(undefined)
    setMessage(undefined)
    try {
      const response = await api.credentials.set({ ref: definition.ref, value })
      if (!response.result.ok) throw new Error(response.result.error.message)
      setDrafts(current => ({ ...current, [definition.id]: '' }))
      await refresh()
      setMessage({ kind: 'notice', text: t('saved') })
    } catch {
      setMessage({ kind: 'error', text: t('saveError') })
    } finally {
      setBusyKey(undefined)
    }
  }

  const remove = async (definition: TwoApiKeyDefinition): Promise<void> => {
    setBusyKey(definition.id as TwoApiKeyId)
    setMessage(undefined)
    try {
      const response = await api.credentials.unset({ ref: definition.ref })
      if (!response.result.ok) throw new Error(response.result.error.message)
      setConfirmingRemoval(undefined)
      await refresh()
      setMessage({ kind: 'notice', text: t('removed') })
    } catch {
      setMessage({ kind: 'error', text: t('removeError') })
    } finally {
      setBusyKey(undefined)
    }
  }

  return (
    <div className={css.section} aria-busy={state === 'loading'}>
      <p className={css.intro}>{t('intro')}</p>
      {message !== undefined ? <p className={message.kind === 'error' ? css.error : css.notice} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p> : null}
      {state === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={() => { void refresh() }}>{t('retry')}</button>
        </div>
      ) : null}
      {state === 'ready' ? (
        <ul className={css.cards}>
          {TWO_API_KEYS.map(definition => (
            <KeyCard
              key={definition.id}
              definition={definition}
              view={views[definition.id]}
              draft={drafts[definition.id]}
              confirmingRemoval={confirmingRemoval === definition.id}
              busy={busyKey === definition.id}
              t={t}
              onDraft={(value) => { updateDraft(definition.id, value) }}
              onSave={() => { void save(definition) }}
              onRequestRemoval={() => { setConfirmingRemoval(definition.id) }}
              onConfirmRemoval={() => { void remove(definition) }}
              onCancelRemoval={() => { setConfirmingRemoval(undefined) }}
            />
          ))}
        </ul>
      ) : null}
    </div>
  )
}
