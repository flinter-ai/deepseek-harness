/** Durable storage-domain declaration for browser source drafts. */

import { z } from 'zod'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { SourceDraft, SourceDraftId, SourceFile } from './types.ts'

const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

/** Runtime schema for one relative source file. */
export const sourceFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
}) satisfies z.ZodType<SourceFile>

/** Persisted Session fields that fence a draft to one log lifecycle. */
export const sourceDraftSessionIdentitySchema = z.object({
  createdAt: nonNegativeSafeInteger,
  cwd: z.string().optional(),
})

/** Runtime schema for one durable source draft. */
export const sourceDraftRecordSchema = z.object({
  draftId: z.string().min(1).transform(value => value as SourceDraftId),
  sessionId: z.string().min(1).transform(value => value as SessionId),
  session: sourceDraftSessionIdentitySchema,
  baseSha: z.string().regex(/^[0-9a-f]{40}$/i),
  files: z.array(sourceFileSchema),
  revision: z.number().int().positive(),
  createdAt: nonNegativeSafeInteger,
  updatedAt: nonNegativeSafeInteger,
}).refine(row => row.updatedAt >= row.createdAt, {
  path: ['updatedAt'],
  message: 'source draft updatedAt must not precede createdAt',
}) as unknown as z.ZodType<SourceDraftRecord>

/** Durable source-draft record inferred from the storage schema. */
export type SourceDraftRecord = Omit<SourceDraft, 'sessionId'> & {
  readonly sessionId: SessionId
  readonly session: z.infer<typeof sourceDraftSessionIdentitySchema>
}

/** One durable record per source draft identity. */
export const sourceDraftDomainSpec = defineDomain({
  name: 'source_drafts',
  version: 0,
  tables: {
    drafts: domainTable<SourceDraftId, SourceDraftRecord>(sourceDraftRecordSchema),
  },
})
