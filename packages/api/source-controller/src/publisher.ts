/** Host-only publication seam for a saved source draft. */

import type { SessionHeader } from '@deepseek-ai/dsh-session/types'
import type { SourceDraft, SourceDraftPublishValue } from './types.ts'

/** Exact input a deployment-specific Git publisher must accept. */
export interface SourcePublisherInput {
  readonly draft: SourceDraft
  readonly session: SessionHeader
  readonly signal: AbortSignal
}

/**
 * Host-side publication contract.
 *
 * The controller intentionally does not implement Git, credentials, or PR
 * provider behavior. An EC2 deployment may compose this interface with its
 * dedicated worktree/branch publisher; browser clients only see its result.
 */
export interface SourcePublisher {
  publish(input: SourcePublisherInput): Promise<SourceDraftPublishValue>
}
