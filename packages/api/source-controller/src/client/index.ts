/** Browser Client installation for durable source drafts. */

import type { Context } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-source-controller/remote'
import { SourceDraftController, type ISourceDrafts } from './service.ts'

export { SourceDraftModel } from './model.ts'
export type {
  SourceDraftModelOptions,
  SourceDraftModelSnapshot,
  SourceDraftModelSource,
  SourceDraftModelStatus,
} from './model.ts'

export { SourceDraftController } from './service.ts'
export type { ISourceDrafts, SourceRemote } from './service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Shared draft save/list/get/delete/publish facade. */
    sourceDrafts: ISourceDrafts
  }
}

/** Required Client Remote services. */
export const inject = ['remote', 'remote.source']

/** Install the shared browser source-draft facade. */
export function apply(ctx: Context): void {
  const remote = ctx.remote as ClientRemote
  new SourceDraftController(ctx, remote.source)
}
