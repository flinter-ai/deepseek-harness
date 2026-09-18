/** React-free Client facade for the Host source-draft Remote namespace. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { RemoteResult, TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-source-controller/remote'
import type {
  SourceDraftBootstrapRequest,
  SourceDraftBootstrapResult,
  SourceDraftDeleteRequest,
  SourceDraftDeleteResult,
  SourceDraftGetRequest,
  SourceDraftGetResult,
  SourceDraftListRequest,
  SourceDraftListResult,
  SourceDraftPublishRequest,
  SourceDraftPublishResult,
  SourceDraftSaveRequest,
  SourceDraftSaveResult,
} from '@deepseek-ai/dsh-source-draft-model/types'

/** Generated Host source namespace used by the browser facade. */
export type SourceRemote = TypertClientRemote['source']

/** Shared draft operations available to Sandpack and direct DSH Web clients. */
export interface ISourceDrafts {
  /**
   * Load the editable file set and its current revision.
   * @param request - Workspace selection.
   * @returns Remote bootstrap result.
   */
  bootstrap(request: SourceDraftBootstrapRequest): Promise<RemoteResult<SourceDraftBootstrapResult>>
  /**
   * List editable drafts for a workspace.
   * @param request - Workspace selection.
   * @returns Remote list result.
   */
  list(request: SourceDraftListRequest): Promise<RemoteResult<SourceDraftListResult>>
  /**
   * Read one draft at its current revision.
   * @param request - Draft identity.
   * @returns Remote read result.
   */
  get(request: SourceDraftGetRequest): Promise<RemoteResult<SourceDraftGetResult>>
  /**
   * Save one revision-fenced draft.
   * @param request - Draft contents and expected revision.
   * @returns Remote save result.
   */
  save(request: SourceDraftSaveRequest): Promise<RemoteResult<SourceDraftSaveResult>>
  /**
   * Delete one revision-fenced draft.
   * @param request - Draft identity and expected revision.
   * @returns Remote delete result.
   */
  delete(request: SourceDraftDeleteRequest): Promise<RemoteResult<SourceDraftDeleteResult>>
  /**
   * Publish a saved draft through the configured Host publisher.
   * @param request - Publication request.
   * @param signal - Optional cancellation signal.
   * @returns Remote publication result.
   */
  publish(
    request: SourceDraftPublishRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<SourceDraftPublishResult>>
}

/** Thin Client service that keeps the wire result visible to editor callers. */
export class SourceDraftController extends Service implements ISourceDrafts {
  constructor(ctx: Context, private readonly remote: SourceRemote) {
    super(ctx, 'sourceDrafts')
  }

  list(request: SourceDraftListRequest): Promise<RemoteResult<SourceDraftListResult>> {
    return this.remote.list(request)
  }

  bootstrap(request: SourceDraftBootstrapRequest): Promise<RemoteResult<SourceDraftBootstrapResult>> {
    return this.remote.bootstrap(request)
  }

  get(request: SourceDraftGetRequest): Promise<RemoteResult<SourceDraftGetResult>> {
    return this.remote.get(request)
  }

  save(request: SourceDraftSaveRequest): Promise<RemoteResult<SourceDraftSaveResult>> {
    return this.remote.save(request)
  }

  delete(request: SourceDraftDeleteRequest): Promise<RemoteResult<SourceDraftDeleteResult>> {
    return this.remote.delete(request)
  }

  publish(
    request: SourceDraftPublishRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<SourceDraftPublishResult>> {
    return this.remote.publish(request, signal)
  }
}
