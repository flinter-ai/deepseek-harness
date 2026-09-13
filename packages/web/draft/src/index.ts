/**
 * Framework-neutral DSH Web draft/save/publish protocol.
 *
 * The client model owns local dirty state and revision-aware transport calls.
 * The host protocol owns storage and delegates publish to a host-owned Git/PR
 * adapter; browser code never receives storage or Git credentials.
 * @module @deepseek-ai/dsh-web-draft
 */

import { Context, Service } from '@deepseek-ai/cordis'

/** Stable draft identity. */
export type DraftId = string & {}

/** Stable server revision used for optimistic conflict detection. */
export type DraftRevision = string & {}

/** Clone and validate a draft id at an untrusted boundary. */
export function draftId(value: string): DraftId {
  validateText(value, 'draft id')
  return value
}

/** Client-visible draft state, including transient network states. */
export type DraftState = 'dirty' | 'saving' | 'conflict' | 'saved' | 'publishing' | 'published'

/** Source files carried by a draft. */
export type DraftFiles = Readonly<Record<string, string>>

/** Host-selected destination for a publish operation. */
export interface DraftPublishTarget {
  readonly kind: 'branch' | 'pull-request'
  readonly branch: string
  readonly title?: string
  readonly body?: string
}

/** Host-owned receipt; a PR URL is optional for branch-only publishes. */
export interface DraftPublishReceipt {
  readonly draftId: DraftId
  readonly revision: DraftRevision
  readonly branch: string
  readonly artifactId: string
  readonly pullRequestUrl?: string
}

/** The durable view returned by a host draft store. */
export interface DraftSnapshot {
  readonly id: DraftId
  readonly workspaceId: string
  readonly revision: DraftRevision
  readonly files: DraftFiles
  readonly updatedAt: number
  readonly published?: DraftPublishReceipt
}

/** Input to an atomic revision-checked save. */
export interface DraftSaveRequest {
  readonly id: DraftId
  readonly workspaceId: string
  readonly baseRevision?: DraftRevision
  readonly files: DraftFiles
  readonly mutationId: string
}

/** Input to a host-owned publish operation. */
export interface DraftPublishRequest {
  readonly id: DraftId
  readonly workspaceId: string
  readonly revision: DraftRevision
  readonly idempotencyKey: string
  readonly target: DraftPublishTarget
}

/** Storage adapter injected into the host protocol. */
export interface DraftStore {
  readonly load: (id: DraftId, workspaceId: string) => Promise<DraftSnapshot | undefined>
  readonly save: (request: DraftSaveRequest) => Promise<DraftSnapshot>
  readonly delete: (id: DraftId, workspaceId: string) => Promise<void>
}

/** Git/PR adapter injected into the host protocol. */
export interface DraftPublisher {
  readonly publish: (request: DraftPublishRequest & { readonly draft: DraftSnapshot }) => Promise<DraftPublishReceipt>
}

/** Transport implemented by a browser client or another editor surface. */
export interface DraftTransport {
  readonly load: (id: DraftId, workspaceId: string) => Promise<DraftSnapshot | undefined>
  readonly save: (request: DraftSaveRequest) => Promise<DraftSnapshot>
  readonly publish: (request: DraftPublishRequest) => Promise<DraftPublishReceipt>
  readonly delete: (id: DraftId, workspaceId: string) => Promise<void>
}

/** Host-side conflict returned when a base revision is no longer current. */
export class DraftConflictError extends Error {
  readonly code = 'DRAFT_CONFLICT' as const
  readonly current: DraftSnapshot | undefined

  constructor(message: string, current?: DraftSnapshot) {
    super(message)
    this.name = 'DraftConflictError'
    this.current = current
  }
}

/** Client-side refusal when publish is attempted before a successful save. */
export class DraftNotSavedError extends Error {
  readonly code = 'DRAFT_NOT_SAVED' as const

  constructor(state: DraftState) {
    super('draft cannot be published while state is ' + state)
    this.name = 'DraftNotSavedError'
  }
}

/** A host protocol error for invalid or unavailable draft operations. */
export class DraftProtocolError extends Error {
  readonly code = 'DRAFT_PROTOCOL_ERROR' as const

  constructor(message: string) {
    super(message)
    this.name = 'DraftProtocolError'
  }
}

/**
 * Client model for Sandpack or another editor. Saves are serialized, edits
 * arriving during a save remain dirty, and deleting the remote draft never
 * deletes the local file map.
 */
export class SourceDraftModel {
  private readonly transport: DraftTransport
  private id: DraftId | undefined
  private workspaceId: string | undefined
  private revision: DraftRevision | undefined
  private draft: DraftSnapshot | undefined
  private files: DraftFiles = Object.freeze({})
  private savedFiles: DraftFiles = Object.freeze({})
  private stateValue: DraftState = 'dirty'
  private saveTail: Promise<void> = Promise.resolve()
  private receipt: DraftPublishReceipt | undefined

  constructor(transport: DraftTransport) {
    this.transport = transport
  }

  get state(): DraftState {
    return this.stateValue
  }

  get snapshot(): DraftSnapshot | undefined {
    return this.draft
  }

  get currentFiles(): DraftFiles {
    return this.files
  }

  get publishReceipt(): DraftPublishReceipt | undefined {
    return this.receipt
  }

  /** Replace local state with the host's current durable snapshot. */
  async load(id: DraftId, workspaceId: string): Promise<DraftSnapshot | undefined> {
    const snapshot = await this.transport.load(id, workspaceId)
    this.id = draftId(id)
    this.workspaceId = workspaceId
    if (snapshot === undefined) {
      this.draft = undefined
      this.revision = undefined
      this.files = Object.freeze({})
      this.savedFiles = Object.freeze({})
      this.receipt = undefined
      this.stateValue = 'dirty'
      return undefined
    }
    this.applySnapshot(snapshot)
    return snapshot
  }

  /** Edit source locally; the caller remains responsible for file semantics. */
  setFiles(files: DraftFiles): void {
    this.files = cloneFiles(files)
    this.receipt = undefined
    this.stateValue = filesEqual(this.files, this.savedFiles)
      ? this.draft?.published === undefined ? 'saved' : 'published'
      : 'dirty'
  }

  /**
   * Save the current local file map. Calls made while another save is active
   * queue behind it and capture the newest files/revision when they start.
   */
  save(mutationId: string): Promise<DraftSnapshot> {
    validateText(mutationId, 'draft mutation id')
    const files = this.files
    const operation = this.saveTail.then(async () => {
      if (this.id === undefined || this.workspaceId === undefined) {
        throw new DraftProtocolError('cannot save a draft before it is loaded')
      }
      const request: DraftSaveRequest = {
        id: this.id,
        workspaceId: this.workspaceId,
        ...(this.revision === undefined ? {} : { baseRevision: this.revision }),
        files,
        mutationId,
      }
      this.stateValue = 'saving'
      try {
        const saved = await this.transport.save(request)
        this.draft = saved
        this.revision = saved.revision
        this.savedFiles = cloneFiles(saved.files)
        this.stateValue = filesEqual(this.files, this.savedFiles) ? 'saved' : 'dirty'
        return saved
      } catch (error: unknown) {
        if (error instanceof DraftConflictError) this.stateValue = 'conflict'
        else this.stateValue = 'dirty'
        throw error
      }
    })
    this.saveTail = operation.then(() => undefined, () => undefined)
    return operation
  }

  /**
   * Publish only the exact saved revision. Dirty, saving, conflict, and
   * already-publishing states are rejected before the host sees the request.
   */
  async publish(idempotencyKey: string, target: DraftPublishTarget): Promise<DraftPublishReceipt> {
    validateText(idempotencyKey, 'draft publish idempotency key')
    validateTarget(target)
    const draft = this.draft
    if (draft === undefined || this.revision === undefined || this.stateValue !== 'saved' || !filesEqual(this.files, this.savedFiles)) {
      throw new DraftNotSavedError(this.stateValue)
    }
    this.stateValue = 'publishing'
    try {
      const receipt = await this.transport.publish({
        id: draft.id,
        workspaceId: draft.workspaceId,
        revision: this.revision,
        idempotencyKey,
        target,
      })
      this.receipt = receipt
      this.draft = { ...draft, published: receipt }
      this.stateValue = 'published'
      return receipt
    } catch (error: unknown) {
      this.stateValue = 'saved'
      throw error
    }
  }

  /**
   * Delete the remote draft but preserve the local file map as dirty work.
   * The caller can save it later as a new remote draft.
   */
  async delete(): Promise<void> {
    const draft = this.draft
    if (draft === undefined) {
      this.stateValue = 'dirty'
      return
    }
    await this.transport.delete(draft.id, draft.workspaceId)
    this.draft = undefined
    this.revision = undefined
    this.savedFiles = Object.freeze({})
    this.receipt = undefined
    this.stateValue = 'dirty'
  }

  private applySnapshot(snapshot: DraftSnapshot): void {
    validateSnapshot(snapshot)
    this.draft = snapshot
    this.id = snapshot.id
    this.workspaceId = snapshot.workspaceId
    this.revision = snapshot.revision
    this.files = cloneFiles(snapshot.files)
    this.savedFiles = cloneFiles(snapshot.files)
    this.receipt = snapshot.published
    this.stateValue = snapshot.published === undefined ? 'saved' : 'published'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    drafts: DraftProtocol
  }
}

/**
 * Host-owned protocol service. Storage, auth, Git, and PR implementations are
 * injected, so browser or Sandpack code cannot write credentials or bypass a
 * host's publish policy.
 */
export class DraftProtocol extends Service implements DraftTransport {
  private readonly store: DraftStore
  private readonly publisher: DraftPublisher

  constructor(ctx: Context, store: DraftStore, publisher: DraftPublisher) {
    super(ctx, 'drafts')
    this.store = store
    this.publisher = publisher
  }

  async load(id: DraftId, workspaceId: string): Promise<DraftSnapshot | undefined> {
    validateText(workspaceId, 'draft workspace id')
    return this.store.load(draftId(id), workspaceId)
  }

  async save(request: DraftSaveRequest): Promise<DraftSnapshot> {
    validateSaveRequest(request)
    const current = await this.store.load(request.id, request.workspaceId)
    if (current === undefined ? request.baseRevision !== undefined : current.revision !== request.baseRevision) {
      throw new DraftConflictError('draft revision is stale', current)
    }
    const saved = await this.store.save({ ...request, files: cloneFiles(request.files) })
    validateSnapshot(saved)
    return saved
  }

  async publish(request: DraftPublishRequest): Promise<DraftPublishReceipt> {
    validatePublishRequest(request)
    const current = await this.store.load(request.id, request.workspaceId)
    if (current === undefined || current.revision !== request.revision) {
      throw new DraftConflictError('draft revision is stale', current)
    }
    return this.publisher.publish({ ...request, draft: current })
  }

  async delete(id: DraftId, workspaceId: string): Promise<void> {
    validateText(workspaceId, 'draft workspace id')
    await this.store.delete(draftId(id), workspaceId)
  }
}

function validateSaveRequest(request: DraftSaveRequest): void {
  draftId(request.id)
  validateText(request.workspaceId, 'draft workspace id')
  if (request.baseRevision !== undefined) validateText(request.baseRevision, 'draft base revision')
  validateText(request.mutationId, 'draft mutation id')
  validateFiles(request.files)
}

function validatePublishRequest(request: DraftPublishRequest): void {
  draftId(request.id)
  validateText(request.workspaceId, 'draft workspace id')
  validateText(request.revision, 'draft revision')
  validateText(request.idempotencyKey, 'draft publish idempotency key')
  validateTarget(request.target)
}

function validateTarget(target: DraftPublishTarget): void {
  validateText(target.branch, 'draft publish branch')
  if (target.title !== undefined) validateText(target.title, 'draft publish title')
  if (target.body !== undefined) validateText(target.body, 'draft publish body')
}

function validateSnapshot(snapshot: DraftSnapshot): void {
  draftId(snapshot.id)
  validateText(snapshot.workspaceId, 'draft workspace id')
  validateText(snapshot.revision, 'draft revision')
  validateFiles(snapshot.files)
  if (!Number.isSafeInteger(snapshot.updatedAt) || snapshot.updatedAt < 0) throw new TypeError('draft updatedAt must be a non-negative safe integer')
}

function validateFiles(files: DraftFiles): void {
  for (const [path, source] of Object.entries(files)) {
    validateText(path, 'draft file path')
    validateText(source, 'draft file source')
  }
}

function cloneFiles(files: DraftFiles): DraftFiles {
  validateFiles(files)
  return Object.freeze(Object.fromEntries(Object.entries(files).map(([path, source]) => [path, source])))
}

function filesEqual(left: DraftFiles, right: DraftFiles): boolean {
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  if (leftEntries.length !== rightEntries.length) return false
  return leftEntries.every(([path, source]) => right[path] === source)
}

function validateText(value: string, field: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\u0000')) {
    throw new TypeError(field + ' must be a non-empty string without NUL')
  }
}

export default DraftProtocol
