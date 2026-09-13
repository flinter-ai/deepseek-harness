import {
  SandpackCodeEditor,
  SandpackLayout,
  SandpackPreview,
  SandpackProvider,
  useSandpack,
} from '@codesandbox/sandpack-react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ISourceDrafts } from '@deepseek-ai/dsh-api-source-controller/client'
import { SourceDraftModel as DraftModel } from '@deepseek-ai/dsh-source-draft-model'
import type { SourceDraftModel, SourceDraftModelSnapshot } from '@deepseek-ai/dsh-source-draft-model'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './SourceEditorAction.module.css'
import type { SourceFile } from '@deepseek-ai/dsh-api-source-controller/types'

/** Runtime face supplied by the plugin's per-Session slot injection. */
export interface SourceEditorInjected {
  readonly sourceDrafts: ISourceDrafts
}

/** Full props for the session-header source-editor action. */
export type SourceEditorActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>
  & SourceEditorInjected

const STARTER_FILE: SourceFile = Object.freeze({
  path: 'index.html',
  content: '<!doctype html>\n<html>\n  <body>\n    <h1>DSH source draft</h1>\n  </body>\n</html>\n',
})

type RemoteFailureShape = { readonly message?: string }
type BusinessResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly reason?: string; readonly message?: string } }
type RemoteEnvelope<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RemoteFailureShape }

/** Render one immutable model snapshot through React's external-store contract. */
function useDraftSnapshot(model: SourceDraftModel): SourceDraftModelSnapshot {
  const subscribe = useCallback((listener: () => void) => model.subscribe(listener), [model])
  const getSnapshot = useCallback(() => model.getSnapshot(), [model])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Extract a stable, user-safe error string from either Remote layer. */
function errorMessage(error: unknown, t: TranslateNS<typeof NS>): string {
  if (error === null || typeof error !== 'object') return t('error')
  const value = error as { readonly code?: unknown; readonly reason?: unknown; readonly message?: unknown }
  if (value.code === 'publisher-unavailable') return t('publisherUnavailable')
  if (value.code === 'version-conflict') return t('conflict')
  if (typeof value.reason === 'string') return value.reason
  if (typeof value.message === 'string') return value.message
  return t('error')
}

function unwrap<T>(result: RemoteEnvelope<BusinessResult<T>>, t: TranslateNS<typeof NS>): T {
  if (!result.ok) throw new Error(errorMessage(result.error, t))
  if (!result.value.ok) throw new Error(errorMessage(result.value.error, t))
  return result.value.value
}

/** Load the newest durable draft, or open a clean Git base for a new one. */
async function openModel(
  sourceDrafts: ISourceDrafts,
  sessionId: SessionId,
  t: TranslateNS<typeof NS>,
): Promise<SourceDraftModel> {
  const listed = await sourceDrafts.list({ sessionId })
  const drafts = unwrap(listed, t).drafts
  const latest = drafts[0]
  if (latest !== undefined) {
    const model = new DraftModel(sourceDrafts, {
      sessionId,
      baseSha: latest.baseSha,
      files: latest.files,
    })
    unwrap(await model.load(latest.draftId), t)
    return model
  }

  const bootstrap = unwrap(await sourceDrafts.bootstrap({ sessionId }), t)
  return new DraftModel(sourceDrafts, {
    sessionId,
    baseSha: bootstrap.baseSha,
  })
}

/** Convert the Sandpack in-memory file map into the SourceDraft wire shape. */
function sourceFilesFromSandpack(files: unknown): SourceFile[] {
  if (files === null || typeof files !== 'object') return []
  const result: SourceFile[] = []
  for (const [rawPath, rawFile] of Object.entries(files as Record<string, unknown>)) {
    if (rawFile === null || typeof rawFile !== 'object') continue
    const code = (rawFile as { readonly code?: unknown }).code
    if (typeof code !== 'string') continue
    const path = rawPath.replace(/^\/+/, '')
    if (path.length > 0) result.push({ path, content: code })
  }
  return result.sort((left, right) => left.path.localeCompare(right.path))
}

function sameFiles(left: readonly SourceFile[], right: readonly SourceFile[]): boolean {
  return left.length === right.length
    && left.every((file, index) => file.path === right[index]?.path && file.content === right[index]?.content)
}

/** Bridges Sandpack's editor buffer into the framework-neutral draft model. */
function SandpackDraftBridge({ model }: { readonly model: SourceDraftModel }): null {
  const { sandpack } = useSandpack()
  const snapshot = useDraftSnapshot(model)
  const seeded = useRef(false)
  useEffect(() => {
    const next = sourceFilesFromSandpack(sandpack.files)
    if (snapshot.files.length === 0 && seeded.current) return
    if (sameFiles(next, snapshot.files)) return
    seeded.current = true
    model.setFiles(next)
  }, [model, sandpack.files, snapshot.files])
  return null
}

/** Sandpack editor/preview surface backed by one SourceDraftModel. */
function SourceEditorSurface({ model, snapshot }: {
  readonly model: SourceDraftModel
  readonly snapshot: SourceDraftModelSnapshot
}): JSX.Element {
  const files = useMemo(() => {
    const source = snapshot.files.length === 0 ? [STARTER_FILE] : snapshot.files
    return Object.fromEntries(source.map(file => [`/${file.path}`, { code: file.content }]))
  }, [snapshot.files])
  return (
    <SandpackProvider template="static" files={files} className={css.sandpack}>
      <SandpackDraftBridge model={model} />
      <SandpackLayout>
        <SandpackCodeEditor showTabs showLineNumbers />
        <SandpackPreview />
      </SandpackLayout>
    </SandpackProvider>
  )
}

function statusLabel(snapshot: SourceDraftModelSnapshot, t: TranslateNS<typeof NS>): string {
  if (snapshot.status === 'saving') return t('saving')
  if (snapshot.status === 'publishing') return t('publishing')
  return t(snapshot.status)
}

/** Modal editor with explicit save and publish actions. */
function SourceEditorDialog({
  model,
  t,
  onClose,
}: {
  readonly model: SourceDraftModel
  readonly t: TranslateNS<typeof NS>
  readonly onClose: () => void
}): JSX.Element {
  const snapshot = useDraftSnapshot(model)
  const [pullRequestUrl, setPullRequestUrl] = useState<string | undefined>()
  const [actionError, setActionError] = useState<string | undefined>()

  const save = async (): Promise<void> => {
    setActionError(undefined)
    try {
      unwrap(await model.save(), t)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('error'))
    }
  }

  const publish = async (): Promise<void> => {
    setActionError(undefined)
    try {
      const result = unwrap(await model.publish(), t)
      setPullRequestUrl(result.pullRequestUrl)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('error'))
    }
  }

  const remove = async (): Promise<void> => {
    if (!window.confirm(t('deleteConfirm'))) return
    setActionError(undefined)
    try {
      unwrap(await model.delete(), t)
      setPullRequestUrl(undefined)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('error'))
    }
  }

  const error = actionError ?? (snapshot.error === null ? undefined : errorMessage(snapshot.error, t))
  const canPublish = snapshot.draft !== null
    && !snapshot.dirty
    && snapshot.status !== 'publishing'
    && snapshot.status !== 'conflict'

  return (
    <div className={css.backdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className={css.dialog} role="dialog" aria-modal="true" aria-label={t('title')}>
        <header className={css.header}>
          <strong className={css.title}>{t('title')}</strong>
          <span className={css.status}>{statusLabel(snapshot, t)}</span>
          <span className={css.meta} title={snapshot.baseSha}>{t('base')}: {snapshot.baseSha.slice(0, 8)}</span>
          <span className={css.meta}>{t('files', { count: snapshot.files.length })}</span>
          <button className={css.button} type="button" onClick={onClose}>{t('close')}</button>
        </header>
        <div className={css.body}>
          <SourceEditorSurface model={model} snapshot={snapshot} />
        </div>
        <footer className={css.footer}>
          <button className={`${css.button} ${css.danger}`} type="button" disabled={snapshot.draft === null} onClick={() => void remove()}>
            {t('delete')}
          </button>
          {error !== undefined ? <span className={css.error} title={error}>{error}</span> : null}
          {pullRequestUrl !== undefined
            ? <a className={css.link} href={pullRequestUrl} target="_blank" rel="noreferrer">{t('publishLink')}</a>
            : null}
          <button className={css.button} type="button" disabled={!snapshot.dirty || snapshot.status === 'saving'} onClick={() => void save()}>
            {snapshot.status === 'saving' ? t('saving') : t('save')}
          </button>
          <button className={`${css.button} ${css.primary}`} type="button" disabled={!canPublish} onClick={() => void publish()}>
            {snapshot.status === 'publishing' ? t('publishing') : t('publish')}
          </button>
        </footer>
      </section>
    </div>
  )
}

/** Session-header action that opens the Sandpack/editor draft surface. */
export function SourceEditorAction({ sessionId, sourceDrafts, t }: SourceEditorActionProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [model, setModel] = useState<SourceDraftModel | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const openEditor = async (): Promise<void> => {
    setOpen(true)
    setLoading(true)
    setError(undefined)
    try {
      setModel(await openModel(sourceDrafts, sessionId, t))
    } catch (value) {
      setError(value instanceof Error ? value.message : t('error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={css.root}>
      <button className={css.trigger} type="button" onClick={() => void openEditor()} aria-label={t('open')}>
        {t('open')}
      </button>
      {open
        ? loading
          ? <div className={css.backdrop} role="presentation"><div className={css.dialog}><div className={css.loading}>{t('loading')}</div></div></div>
          : model === null
            ? <div className={css.backdrop} role="presentation"><section className={css.dialog} role="dialog" aria-modal="true" aria-label={t('title')}><div className={css.empty}>{error ?? t('error')}<button className={css.button} type="button" onClick={() => setOpen(false)}>{t('close')}</button></div></section></div>
            : <SourceEditorDialog model={model} t={t} onClose={() => setOpen(false)} />
        : null}
    </div>
  )
}
