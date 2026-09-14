/** Framework-neutral source-draft and editor transport vocabulary. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** Opaque identity for one durable source draft. */
export type SourceDraftId = Branded<'source-draft-id'>

/** One relative source file supplied by Sandpack or another editor. */
export interface SourceFile {
  readonly path: string
  readonly content: string
}

/** The Host-authoritative saved source draft. */
export interface SourceDraft {
  readonly draftId: SourceDraftId
  readonly sessionId: SessionId
  readonly baseSha: string
  readonly files: readonly SourceFile[]
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}

/** Create or replace one draft using optimistic revision fencing. */
export interface SourceDraftSaveRequest {
  readonly draftId?: SourceDraftId
  readonly sessionId: SessionId
  readonly baseSha: string
  readonly files: readonly SourceFile[]
  readonly expectedRevision?: number
}

/** Read one server draft belonging to a Session. */
export interface SourceDraftGetRequest {
  readonly sessionId: SessionId
  readonly draftId: SourceDraftId
}

/** List drafts for one Session lifecycle. */
export interface SourceDraftListRequest {
  readonly sessionId: SessionId
}

/** Open the current Git base for a browser editor. */
export interface SourceDraftBootstrapRequest {
  readonly sessionId: SessionId
}

/** Git base returned before a new editor buffer is created. */
export interface SourceDraftBootstrapValue {
  readonly baseSha: string
}

/** Delete one draft after an optional revision check. */
export interface SourceDraftDeleteRequest {
  readonly sessionId: SessionId
  readonly draftId: SourceDraftId
  readonly expectedRevision?: number
}

/** Request Host-side publication of one exact saved draft. */
export interface SourceDraftPublishRequest {
  readonly sessionId: SessionId
  readonly draftId: SourceDraftId
  readonly expectedRevision: number
}

/** Result returned by a configured Host publisher. */
export interface SourceDraftPublishValue {
  readonly branch: string
  readonly commit: string
  readonly pullRequestUrl?: string
}

/** Successful result returned by a source-draft operation. */
export interface SourceDraftSuccess<T> {
  readonly ok: true
  readonly value: T
}

/** Rejection for a Session that no longer exists or is not visible. */
export interface SourceDraftSessionNotFound {
  readonly code: 'session-not-found'
  readonly sessionId: SessionId
}

/** Rejection for a draft that is absent or belongs to another Session. */
export interface SourceDraftNotFound {
  readonly code: 'draft-not-found'
  readonly draftId: SourceDraftId
}

/** Rejection carrying the current draft after an optimistic fence mismatch. */
export interface SourceDraftVersionConflict {
  readonly code: 'version-conflict'
  readonly current: SourceDraft | null
}

/** Rejection for invalid or unsafe source input. */
export interface SourceDraftRejected {
  readonly code: 'source-rejected'
  readonly reason: string
}

/** The editor must save a current snapshot before a local action can proceed. */
export interface SourceDraftNotReady {
  readonly code: 'source-draft-not-ready'
  readonly reason: string
}

/** Rejection when no host-owned publisher is configured. */
export interface SourcePublisherUnavailable {
  readonly code: 'publisher-unavailable'
}

/** Rejection when the host publisher cannot complete publication. */
export interface SourcePublishFailed {
  readonly code: 'publish-failed'
  readonly message: string
}

/** Union of all durable source-draft rejection variants. */
export type SourceDraftFailure =
  | SourceDraftSessionNotFound
  | SourceDraftNotFound
  | SourceDraftVersionConflict
  | SourceDraftRejected
  | SourceDraftNotReady
  | SourcePublisherUnavailable
  | SourcePublishFailed

/** Result wrapper for a source-draft operation that was rejected. */
export interface SourceDraftRejectedResult<E extends SourceDraftFailure = SourceDraftFailure> {
  readonly ok: false
  readonly error: E
}

/** Union of a successful source-draft result and a safe rejection. */
export type SourceDraftResult<T, E extends SourceDraftFailure = SourceDraftFailure> =
  | SourceDraftSuccess<T>
  | SourceDraftRejectedResult<E>

/** Result returned by a save operation. */
export type SourceDraftSaveResult = SourceDraftResult<SourceDraft>
/** Result returned by a get operation. */
export type SourceDraftGetResult = SourceDraftResult<SourceDraft>
/** Result returned by a list operation. */
export type SourceDraftListResult = SourceDraftResult<{ readonly drafts: readonly SourceDraft[] }>
/** Result returned by a bootstrap operation. */
export type SourceDraftBootstrapResult = SourceDraftResult<SourceDraftBootstrapValue>
/** Result returned by a delete operation. */
export type SourceDraftDeleteResult = SourceDraftResult<{ readonly deleted: true }>
/** Result returned by a publish operation. */
export type SourceDraftPublishResult = SourceDraftResult<SourceDraftPublishValue>

/** Remote service consumed by the framework-neutral model. */
export interface SourceDraftRemote {
  bootstrap(request: SourceDraftBootstrapRequest): Promise<RemoteResult<SourceDraftBootstrapResult>>
  list(request: SourceDraftListRequest): Promise<RemoteResult<SourceDraftListResult>>
  get(request: SourceDraftGetRequest): Promise<RemoteResult<SourceDraftGetResult>>
  save(request: SourceDraftSaveRequest): Promise<RemoteResult<SourceDraftSaveResult>>
  delete(request: SourceDraftDeleteRequest): Promise<RemoteResult<SourceDraftDeleteResult>>
  publish(
    request: SourceDraftPublishRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<SourceDraftPublishResult>>
}

/** Failure values an editor model may expose from local or remote work. */
export type SourceDraftModelFailure = SourceDraftFailure | RemoteFailure
