/** React-free source-draft state machine for Sandpack and other editors. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  SourceDraft,
  SourceDraftId,
  SourceDraftModelFailure,
  SourceDraftPublishValue,
  SourceDraftRemote,
  SourceDraftResult,
  SourceFile,
} from './types.ts'

/** State visible to an editor adapter. */
export type SourceDraftModelStatus =
  | 'idle'
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'publishing'
  | 'published'
  | 'conflict'
  | 'error'

/** Stable projection for one editable source draft. */
export interface SourceDraftModelSnapshot {
  readonly sessionId: SessionId
  readonly baseSha: string
  readonly draft: SourceDraft | null
  readonly files: readonly SourceFile[]
  readonly status: SourceDraftModelStatus
  readonly dirty: boolean
  readonly error: SourceDraftModelFailure | null
}

/** Inputs required to bind an editor buffer to one Session and Git base. */
export interface SourceDraftModelOptions {
  readonly sessionId: SessionId
  readonly baseSha: string
  readonly files?: readonly SourceFile[]
}

/** Observable source used by framework adapters without coupling to React. */
export interface SourceDraftModelSource {
  getSnapshot(): SourceDraftModelSnapshot
  subscribe(listener: () => void): () => void
}

type SourceDraftCallResult<T> = import('@deepseek-ai/dsh-typert-protocol').RemoteResult<SourceDraftResult<T>>

/**
 * Coordinates an editor snapshot with the durable Host Remote.
 *
 * Saves are serialized so every request uses the revision returned by the
 * previous one. If the editor changes while a request is in flight, the
 * returned server revision is retained but newer local files stay dirty.
 * Publishing never silently publishes unsaved browser state.
 */
export class SourceDraftModel implements SourceDraftModelSource {
  private readonly listeners = new Set<() => void>()
  private readonly remote: SourceDraftRemote
  private readonly sessionId: SessionId
  private baseSha: string
  private files: readonly SourceFile[]
  private draft: SourceDraft | null = null
  private status: SourceDraftModelStatus
  private error: SourceDraftModelFailure | null = null
  private generation = 0
  private snapshotCache: SourceDraftModelSnapshot
  private snapshotDirty = true
  private operationTail: Promise<void> = Promise.resolve()

  constructor(remote: SourceDraftRemote, options: SourceDraftModelOptions) {
    this.remote = remote
    this.sessionId = options.sessionId
    this.baseSha = options.baseSha
    this.files = freezeFiles(options.files ?? [])
    this.status = options.files === undefined ? 'idle' : 'dirty'
    this.snapshotCache = this.buildSnapshot()
  }

  getSnapshot(): SourceDraftModelSnapshot {
    if (this.snapshotDirty) {
      this.snapshotCache = this.buildSnapshot()
      this.snapshotDirty = false
    }
    return this.snapshotCache
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  setFiles(files: readonly SourceFile[]): void {
    this.files = freezeFiles(files)
    this.generation += 1
    this.status = 'dirty'
    this.error = null
    this.invalidate()
  }

  save(): Promise<SourceDraftCallResult<SourceDraft>> {
    return this.enqueue(async () => {
      const generation = this.generation
      const request = {
        ...(this.draft === null ? {} : {
          draftId: this.draft.draftId,
          expectedRevision: this.draft.revision,
        }),
        sessionId: this.sessionId,
        baseSha: this.baseSha,
        files: this.files,
      }
      this.status = 'saving'
      this.error = null
      this.invalidate()

      try {
        const result = await this.remote.save(request)
        if (!result.ok) {
          if (generation === this.generation) this.fail(result.error, 'error')
          return result
        }
        this.installBusinessResult(result.value, generation)
        return result
      } catch (error) {
        if (generation === this.generation) this.fail(null, 'error')
        throw error
      }
    })
  }

  load(draftId: SourceDraftId): Promise<SourceDraftCallResult<SourceDraft>> {
    return this.enqueue(async () => {
      const generation = this.generation
      const result = await this.remote.get({ sessionId: this.sessionId, draftId })
      if (!result.ok) {
        if (generation === this.generation) this.fail(result.error, 'error')
        return result
      }
      this.installBusinessResult(result.value, generation)
      return result
    })
  }

  publish(signal?: AbortSignal): Promise<SourceDraftCallResult<SourceDraftPublishValue>> {
    return this.enqueue(async () => {
      const generation = this.generation
      if (this.draft === null || this.status === 'dirty' || this.status === 'conflict') {
        const result = localFailure<SourceDraftPublishValue>(
          'source-draft-not-ready',
          'save the current editor snapshot before publishing',
        )
        if (generation === this.generation) this.fail(result.error, 'error')
        return result
      }

      this.status = 'publishing'
      this.error = null
      this.invalidate()
      const result = await this.remote.publish({
        sessionId: this.sessionId,
        draftId: this.draft.draftId,
        expectedRevision: this.draft.revision,
      }, signal)
      if (!result.ok) {
        if (generation === this.generation) this.fail(result.error, 'error')
        return result
      }
      if (!result.value.ok) {
        if (generation === this.generation) this.fail(result.value.error, 'conflict')
        return result
      }
      if (generation === this.generation) {
        this.status = 'published'
        this.error = null
        this.invalidate()
      }
      return result
    })
  }

  delete(): Promise<SourceDraftCallResult<{ readonly deleted: true }>> {
    return this.enqueue(async () => {
      const generation = this.generation
      if (this.draft === null) {
        const result = localFailure<{ readonly deleted: true }>(
          'source-draft-not-ready',
          'there is no saved draft to delete',
        )
        if (generation === this.generation) this.fail(result.error, 'error')
        return result
      }
      const result = await this.remote.delete({
        sessionId: this.sessionId,
        draftId: this.draft.draftId,
        expectedRevision: this.draft.revision,
      })
      if (!result.ok) {
        if (generation === this.generation) this.fail(result.error, 'error')
        return result
      }
      if (!result.value.ok) {
        if (generation === this.generation) this.fail(result.value.error, 'conflict')
        return result
      }
      this.draft = null
      this.status = generation === this.generation && this.files.length === 0 ? 'idle' : 'dirty'
      this.error = null
      this.invalidate()
      return result
    })
  }

  private buildSnapshot(): SourceDraftModelSnapshot {
    return Object.freeze({
      sessionId: this.sessionId,
      baseSha: this.baseSha,
      draft: this.draft,
      files: this.files,
      status: this.status,
      dirty: this.status === 'dirty' || this.status === 'conflict',
      error: this.error,
    })
  }

  private installBusinessResult<T extends SourceDraft>(
    result: SourceDraftResult<T>,
    generation: number,
  ): void {
    if (!result.ok) {
      if (generation === this.generation) {
        this.draft = result.error.code === 'version-conflict' ? freezeDraft(result.error.current) : this.draft
        this.fail(result.error, result.error.code === 'version-conflict' ? 'conflict' : 'error')
      }
      return
    }
    const savedDraft = freezeDraft(result.value)
    this.draft = savedDraft
    this.baseSha = savedDraft.baseSha
    if (generation === this.generation) {
      this.files = savedDraft.files
      this.status = 'saved'
      this.error = null
    } else {
      this.status = 'dirty'
      this.error = null
    }
    this.invalidate()
  }

  private fail(error: SourceDraftModelFailure | null, status: Extract<SourceDraftModelStatus, 'error' | 'conflict'>): void {
    this.error = error
    this.status = status
    this.invalidate()
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.operationTail.then(operation, operation)
    this.operationTail = current.then(() => undefined, () => undefined)
    return current
  }

  private invalidate(): void {
    this.snapshotDirty = true
    for (const listener of this.listeners) listener()
  }
}

function freezeFiles(files: readonly SourceFile[]): readonly SourceFile[] {
  return Object.freeze(files.map(file => Object.freeze({ path: file.path, content: file.content })))
}

function freezeDraft(draft: SourceDraft): SourceDraft
function freezeDraft(draft: SourceDraft | null): SourceDraft | null
function freezeDraft(draft: SourceDraft | null): SourceDraft | null {
  if (draft === null) return null
  return Object.freeze({ ...draft, files: freezeFiles(draft.files) })
}

function localFailure<T>(code: string, message: string): SourceDraftCallResult<T> & { readonly ok: false } {
  return {
    ok: false,
    error: Object.freeze({ code, message, details: {} }),
  }
}
