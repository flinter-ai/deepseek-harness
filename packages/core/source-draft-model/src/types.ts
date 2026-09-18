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

/** Successful source-draft operation result. */
export interface SourceDraftSuccess<T> {
  readonly ok: true
  readonly value: T
}

/** Session identity was not found. */
export interface SourceDraftSessionNotFound {
  readonly code: 'session-not-found'
  readonly sessionId: SessionId
}

/** Draft identity was not found. */
export interface SourceDraftNotFound {
  readonly code: 'draft-not-found'
  readonly draftId: SourceDraftId
}

/** Draft revision did not match the expected fence. */
export interface SourceDraftVersionConflict {
  readonly code: 'version-conflict'
  readonly current: SourceDraft | null
}

/** Draft request was rejected by validation. */
export interface SourceDraftRejected {
  readonly code: 'source-rejected'
  readonly reason: string
}

/** No publisher is configured for publication. */
export interface SourcePublisherUnavailable {
  readonly code: 'publisher-unavailable'
}

/** Publication failed at the provider boundary. */
export interface SourcePublishFailed {
  readonly code: 'publish-failed'
  readonly message: string
}

/** All business failures returned by the source-draft service. */
export type SourceDraftFailure =
  | SourceDraftSessionNotFound
  | SourceDraftNotFound
  | SourceDraftVersionConflict
  | SourceDraftRejected
  | SourcePublisherUnavailable
  | SourcePublishFailed

/** Failed source-draft operation result. */
export interface SourceDraftRejectedResult<E extends SourceDraftFailure = SourceDraftFailure> {
  readonly ok: false
  readonly error: E
}

/** Union of successful and failed source-draft results. */
export type SourceDraftResult<T, E extends SourceDraftFailure = SourceDraftFailure> =
  | SourceDraftSuccess<T>
  | SourceDraftRejectedResult<E>

/** Result of saving a draft. */
export type SourceDraftSaveResult = SourceDraftResult<SourceDraft>
/** Result of loading a draft. */
export type SourceDraftGetResult = SourceDraftResult<SourceDraft>
/** Result of listing drafts. */
export type SourceDraftListResult = SourceDraftResult<{ readonly drafts: readonly SourceDraft[] }>
/** Result of bootstrapping a draft. */
export type SourceDraftBootstrapResult = SourceDraftResult<SourceDraftBootstrapValue>
/** Result of deleting a draft. */
export type SourceDraftDeleteResult = SourceDraftResult<{ readonly deleted: true }>
/** Result of publishing a draft. */
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

/** Failures observable by the framework-neutral model. */
export type SourceDraftModelFailure = SourceDraftFailure | RemoteFailure
