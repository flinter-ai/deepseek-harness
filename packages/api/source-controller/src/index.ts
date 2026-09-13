/** Host Remote owner for durable browser source drafts. */

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { posix as pathPosix } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session/types'
import { ApiSessionNotFound } from '@deepseek-ai/dsh-api-session-controller'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { resolveGitCommit, resolveGitRepository } from '@deepseek-ai/dsh-workspace/src/git-worktree'
import { sourceDraftDomainSpec } from './spec.ts'
import type { SourceDraftRecord } from './spec.ts'
import type { SourcePublisher } from './publisher.ts'
import type {
  SourceDraftBootstrapRequest,
  SourceDraftBootstrapResult,
  SourceDraft,
  SourceDraftDeleteRequest,
  SourceDraftDeleteResult,
  SourceDraftFailure,
  SourceDraftGetRequest,
  SourceDraftGetResult,
  SourceDraftId,
  SourceDraftListRequest,
  SourceDraftListResult,
  SourceDraftPublishRequest,
  SourceDraftPublishResult,
  SourceDraftPublishValue,
  SourceDraftRejected,
  SourceDraftRejectedResult,
  SourceDraftResult,
  SourceDraftSaveRequest,
  SourceDraftSaveResult,
  SourceDraftSessionNotFound,
  SourceFile,
} from './types.ts'

export type * from './types.ts'
export type { SourcePublisher, SourcePublisherInput } from './publisher.ts'
export { sourceDraftDomainSpec, sourceDraftRecordSchema, sourceDraftSessionIdentitySchema, sourceFileSchema } from './spec.ts'
export type { SourceDraftRecord } from './spec.ts'

const DEFAULT_MAX_FILES = 200
const DEFAULT_MAX_FILE_BYTES = 512 * 1024
const DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024

/** Deployment limits for browser-provided source material. */
export interface Config {
  readonly maxFiles?: number
  readonly maxFileBytes?: number
  readonly maxTotalBytes?: number
}

/** Replaceable host publication seam used by tests and deployment adapters. */
export interface SourceControllerInternals {
  readonly publisher?: SourcePublisher
  readonly now?: () => number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the durable source-draft Remote namespace. */
    sourceController: SourceController
    /** Optional deployment-owned Git/PR publisher. */
    sourcePublisher?: SourcePublisher
  }
}

function success<T>(value: T): { readonly ok: true; readonly value: T } {
  return Object.freeze({ ok: true, value })
}

function rejected<E extends SourceDraftFailure>(error: E): SourceDraftRejectedResult<E> {
  return Object.freeze({ ok: false, error: Object.freeze(error) })
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0
}

function resolveLimit(name: string, value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback
  if (!positiveSafeInteger(resolved)) {
    throw new TypeError(`source-controller: ${name} must be a positive safe integer`)
  }
  return resolved
}

function identityOf(header: SessionHeader): SourceDraftRecord['session'] {
  return Object.freeze({
    createdAt: header.createdAt,
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
  })
}

function sameIdentity(row: SourceDraftRecord, sessionId: SessionId, header: SessionHeader): boolean {
  return row.sessionId === sessionId
    && row.session.createdAt === header.createdAt
    && row.session.cwd === header.cwd
}

function snapshotDraft(row: SourceDraftRecord): SourceDraft {
  const files = Object.freeze(row.files.map(file => Object.freeze({
    path: file.path,
    content: file.content,
  })))
  return Object.freeze({
    draftId: row.draftId,
    sessionId: row.sessionId,
    baseSha: row.baseSha,
    files,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

function notFound(draftId: SourceDraftId): SourceDraftRejectedResult {
  return rejected({ code: 'draft-not-found', draftId })
}

function versionConflict(current: SourceDraft | null): SourceDraftRejectedResult {
  return rejected({ code: 'version-conflict', current })
}

function sessionNotFound(sessionId: SessionId): SourceDraftRejectedResult<SourceDraftSessionNotFound> {
  return rejected({ code: 'session-not-found', sessionId })
}

function snapshotPublishValue(value: SourceDraftPublishValue): SourceDraftPublishValue {
  if (typeof value.branch !== 'string' || value.branch.length === 0
    || typeof value.commit !== 'string' || value.commit.length === 0
    || (value.pullRequestUrl !== undefined && typeof value.pullRequestUrl !== 'string')) {
    throw new TypeError('source publisher returned an invalid publication result')
  }
  return Object.freeze({
    branch: value.branch,
    commit: value.commit,
    ...(value.pullRequestUrl === undefined ? {} : { pullRequestUrl: value.pullRequestUrl }),
  })
}

function isProtectedPath(path: string): boolean {
  const segments = path.split('/')
  const basename = segments.at(-1) ?? ''
  if (segments.includes('.git') || segments.includes('node_modules')) return true
  if (path === '.npmrc' || path === '.aws/credentials' || path === '.aws/config') return true
  if (basename === '.env' || (basename.startsWith('.env.') && basename !== '.env.example')) return true
  if (basename === 'id_rsa' || basename.startsWith('id_rsa.')) return true
  return /\.(?:pem|key|p12|pfx)$/i.test(basename)
}

function normalizeFiles(
  files: readonly SourceFile[],
  limits: { readonly maxFiles: number; readonly maxFileBytes: number; readonly maxTotalBytes: number },
): SourceDraftResult<readonly SourceFile[], SourceDraftRejected> {
  if (!Array.isArray(files)) {
    return rejected({ code: 'source-rejected', reason: 'files must be an array' })
  }
  if (files.length > limits.maxFiles) {
    return rejected({ code: 'source-rejected', reason: `at most ${limits.maxFiles} files may be saved` })
  }

  const seen = new Set<string>()
  const normalized: SourceFile[] = []
  let totalBytes = 0
  for (const file of files) {
    if (file === null || typeof file !== 'object'
      || typeof file.path !== 'string' || typeof file.content !== 'string') {
      return rejected({ code: 'source-rejected', reason: 'every file needs a string path and content' })
    }
    const path = file.path
    if (path.length === 0 || path.length > 1024 || path.includes('\\') || path.includes('\0')
      || path.startsWith('/') || pathPosix.normalize(path) !== path
      || path.split('/').some((segment: string) => segment === '' || segment === '.' || segment === '..')) {
      return rejected({ code: 'source-rejected', reason: `unsafe relative source path: ${path}` })
    }
    if (isProtectedPath(path)) {
      return rejected({ code: 'source-rejected', reason: `protected source path is not accepted: ${path}` })
    }
    if (seen.has(path)) {
      return rejected({ code: 'source-rejected', reason: `duplicate source path: ${path}` })
    }
    seen.add(path)
    const fileBytes = Buffer.byteLength(file.content, 'utf8')
    if (fileBytes > limits.maxFileBytes) {
      return rejected({
        code: 'source-rejected',
        reason: `source file ${path} exceeds ${limits.maxFileBytes} UTF-8 bytes`,
      })
    }
    totalBytes += fileBytes
    if (totalBytes > limits.maxTotalBytes) {
      return rejected({
        code: 'source-rejected',
        reason: `source draft exceeds ${limits.maxTotalBytes} UTF-8 bytes`,
      })
    }
    normalized.push({ path, content: file.content })
  }

  normalized.sort((left, right) => left.path.localeCompare(right.path))
  return success(Object.freeze(normalized.map(file => Object.freeze(file))))
}

/**
 * Durable source-draft service shared by direct DSH Web and browser editors.
 * It owns draft persistence and optimistic fencing; Git/PR side effects are
 * delegated to an optional host publisher and otherwise fail closed.
 */
export class SourceController extends TypertRemoteService {
  static inject = ['storageDomain', 'sessionController']

  static Config: s<Config> = s.object({
    maxFiles: s.natural().default(DEFAULT_MAX_FILES),
    maxFileBytes: s.natural().default(DEFAULT_MAX_FILE_BYTES),
    maxTotalBytes: s.natural().default(DEFAULT_MAX_TOTAL_BYTES),
  })

  private readonly maxFiles: number
  private readonly maxFileBytes: number
  private readonly maxTotalBytes: number
  private readonly explicitPublisher: SourcePublisher | undefined
  private readonly now: () => number
  private table?: KvTable<SourceDraftId, SourceDraftRecord>
  private readonly operationTails = new Map<SourceDraftId, Promise<void>>()
  private mutationAdmissionOpen = true

  constructor(ctx: Context, config: Config = {}, internals: SourceControllerInternals = {}) {
    super(ctx, 'sourceController', { namespace: 'source' })
    this.maxFiles = resolveLimit('maxFiles', config.maxFiles, DEFAULT_MAX_FILES)
    this.maxFileBytes = resolveLimit('maxFileBytes', config.maxFileBytes, DEFAULT_MAX_FILE_BYTES)
    this.maxTotalBytes = resolveLimit('maxTotalBytes', config.maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES)
    this.explicitPublisher = internals.publisher
    this.now = internals.now ?? Date.now
  }

  /** Open and own the source-draft storage domain. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(sourceDraftDomainSpec)
    this.ctx.effect(() => async () => {
      this.mutationAdmissionOpen = false
      await Promise.all(this.operationTails.values())
      await domain.close()
    }, 'source-controller.domainClose')
    this.table = domain.table('drafts')
  }

  /** Resolve the exact Git base used to create a new browser editor buffer. */
  @Remote('bootstrap')
  async bootstrap(request: SourceDraftBootstrapRequest): Promise<SourceDraftBootstrapResult> {
    const known = await this.inspectSession(request.sessionId)
    if (!known.ok) return known
    const cwd = known.value.meta.cwd
    if (cwd === undefined) {
      return rejected({ code: 'source-rejected', reason: 'session has no project cwd' })
    }
    try {
      const repositoryRoot = await resolveGitRepository(cwd)
      const baseSha = await resolveGitCommit(repositoryRoot, 'HEAD')
      return success({ baseSha })
    } catch {
      // Keep host filesystem/Git diagnostics out of the browser wire result.
      return rejected({ code: 'source-rejected', reason: 'session project is not a usable Git repository' })
    }
  }

  /** List drafts belonging to one persisted Session lifecycle. */
  @Remote('list')
  async list(request: SourceDraftListRequest): Promise<SourceDraftListResult> {
    const known = await this.inspectSession(request.sessionId)
    if (!known.ok) return known
    const drafts = [...this.requireTable().entries()]
      .filter(([, row]) => sameIdentity(row, request.sessionId, known.value.meta))
      .map(([, row]) => snapshotDraft(row))
      .sort((left, right) => right.updatedAt - left.updatedAt || left.draftId.localeCompare(right.draftId))
    return success({ drafts: Object.freeze(drafts) })
  }

  /** Load one draft only when its Session lifecycle still matches. */
  @Remote('get')
  async get(request: SourceDraftGetRequest): Promise<SourceDraftGetResult> {
    const known = await this.inspectSession(request.sessionId)
    if (!known.ok) return known
    const row = this.requireTable().get(request.draftId)
    if (row === undefined || !sameIdentity(row, request.sessionId, known.value.meta)) {
      return notFound(request.draftId)
    }
    return success(snapshotDraft(row))
  }

  /** Save a complete, normalized source snapshot with optimistic fencing. */
  @Remote('save')
  save(request: SourceDraftSaveRequest): Promise<SourceDraftSaveResult> {
    const files = normalizeFiles(request.files, {
      maxFiles: this.maxFiles,
      maxFileBytes: this.maxFileBytes,
      maxTotalBytes: this.maxTotalBytes,
    })
    if (!files.ok) return Promise.resolve(files)
    if (!/^[0-9a-f]{40}$/i.test(request.baseSha)) {
      return Promise.resolve(rejected({
        code: 'source-rejected',
        reason: 'baseSha must be an exact 40-hex Git object id',
      }))
    }
    const baseSha = request.baseSha.toLowerCase()
    if (request.expectedRevision !== undefined && !positiveSafeInteger(request.expectedRevision)) {
      return Promise.resolve(rejected({
        code: 'source-rejected',
        reason: 'expectedRevision must be a positive safe integer',
      }))
    }
    const draftId = request.draftId ?? randomUUID() as SourceDraftId
    if (typeof draftId !== 'string' || draftId.length === 0) {
      return Promise.resolve(rejected({ code: 'source-rejected', reason: 'draftId must be non-empty' }))
    }
    return this.enqueue(draftId, async () => {
      const known = await this.inspectSession(request.sessionId)
      if (!known.ok) return known
      const table = this.requireTable()
      const current = table.get(draftId)
      if (current !== undefined && !sameIdentity(current, request.sessionId, known.value.meta)) {
        return notFound(draftId)
      }
      if (current === undefined) {
        if (request.expectedRevision !== undefined) return versionConflict(null)
      } else {
        if (request.expectedRevision === undefined || request.expectedRevision !== current.revision) {
          return versionConflict(snapshotDraft(current))
        }
        if (current.baseSha !== baseSha) {
          return rejected({ code: 'source-rejected', reason: 'baseSha cannot change for an existing draft' })
        }
      }
      this.assertMutationAdmission()
      const now = Math.max(this.now(), current?.createdAt ?? 0, current?.updatedAt ?? 0)
      const row: SourceDraftRecord = {
        draftId,
        sessionId: request.sessionId,
        session: identityOf(known.value.meta),
        baseSha,
        files: files.value,
        revision: current === undefined ? 1 : current.revision + 1,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      }
      await table.put(draftId, row)
      return success(snapshotDraft(row))
    })
  }

  /** Delete one draft after an optional revision check. */
  @Remote('delete')
  delete(request: SourceDraftDeleteRequest): Promise<SourceDraftDeleteResult> {
    if (request.expectedRevision !== undefined && !positiveSafeInteger(request.expectedRevision)) {
      return Promise.resolve(rejected({
        code: 'source-rejected',
        reason: 'expectedRevision must be a positive safe integer',
      }))
    }
    return this.enqueue(request.draftId, async () => {
      const known = await this.inspectSession(request.sessionId)
      if (!known.ok) return known
      const table = this.requireTable()
      const current = table.get(request.draftId)
      if (current === undefined || !sameIdentity(current, request.sessionId, known.value.meta)) {
        return notFound(request.draftId)
      }
      if (request.expectedRevision !== undefined && request.expectedRevision !== current.revision) {
        return versionConflict(snapshotDraft(current))
      }
      this.assertMutationAdmission()
      await table.delete(request.draftId)
      return success({ deleted: true as const })
    })
  }

  /** Publish one exact saved revision through the optional host publisher. */
  @Remote('publish')
  publish(request: SourceDraftPublishRequest, signal: AbortSignal): Promise<SourceDraftPublishResult> {
    return this.enqueue(request.draftId, async () => {
      const known = await this.inspectSession(request.sessionId)
      if (!known.ok) return known
      const row = this.requireTable().get(request.draftId)
      if (row === undefined || !sameIdentity(row, request.sessionId, known.value.meta)) {
        return notFound(request.draftId)
      }
      const current = snapshotDraft(row)
      if (request.expectedRevision !== current.revision) return versionConflict(current)
      const publisher = this.explicitPublisher ?? this.ctx.get('sourcePublisher')
      if (publisher === undefined) return rejected({ code: 'publisher-unavailable' })
      if (signal.aborted) throw signal.reason ?? new Error('source publication aborted')
      try {
        return success(snapshotPublishValue(await publisher.publish({
          draft: current,
          session: known.value.meta,
          signal,
        })))
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? error
        return rejected({
          code: 'publish-failed',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    })
  }

  private requireTable(): KvTable<SourceDraftId, SourceDraftRecord> {
    if (this.table === undefined) throw new Error('source-controller storage domain is not initialized')
    return this.table
  }

  private async inspectSession(sessionId: SessionId): Promise<
    | { readonly ok: true; readonly value: { readonly meta: SessionHeader } }
    | SourceDraftRejectedResult<SourceDraftSessionNotFound>
  > {
    try {
      const inspected = await this.ctx.sessionController.inspect(sessionId)
      return success({ meta: inspected.meta })
    } catch (error) {
      if (error instanceof ApiSessionNotFound) return sessionNotFound(sessionId)
      throw error
    }
  }

  private assertMutationAdmission(): void {
    if (!this.mutationAdmissionOpen) throw new Error('source-controller is closing')
  }

  private enqueue<T>(draftId: SourceDraftId, operation: () => Promise<T>): Promise<T> {
    const previous = this.operationTails.get(draftId) ?? Promise.resolve()
    const current = previous.then(operation, operation)
    const tail = current.then(() => undefined, () => undefined)
    this.operationTails.set(draftId, tail)
    return current.finally(() => {
      if (this.operationTails.get(draftId) === tail) this.operationTails.delete(draftId)
    })
  }
}

export default SourceController
