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
} from '../types.ts'

/** Generated Host source namespace used by the browser facade. */
export type SourceRemote = TypertClientRemote['source']

/** Shared draft operations available to Sandpack and direct DSH Web clients. */
export interface ISourceDrafts {
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
