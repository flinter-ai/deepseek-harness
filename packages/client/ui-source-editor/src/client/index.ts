/** Sandpack source editor browser plugin with durable SourceDraftModel state. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISourceDrafts } from '@deepseek-ai/dsh-api-source-controller/client'
import type {} from '@deepseek-ai/dsh-api-source-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { SourceEditorAction, type SourceEditorInjected } from './SourceEditorAction.tsx'
import { en, NS, zh, type SourceEditorKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Source draft editor copy. */
    sourceEditor: SourceEditorKey
  }
}

export { SourceEditorAction, type SourceEditorActionProps, type SourceEditorInjected } from './SourceEditorAction.tsx'
export { en, NS, zh } from './locales.ts'

/** Client services required by the source-editor action. */
export const inject = ['sourceDrafts', 'slots', 'locale']

/** Install dictionaries and the per-Session header action. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-source-editor: dictionaries')
  const sourceDrafts = ctx.get('sourceDrafts') as ISourceDrafts
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'source-editor',
      order: 25,
      locale: NS,
      inject: (): SourceEditorInjected => ({ sourceDrafts }),
    }, SourceEditorAction),
  )
}
