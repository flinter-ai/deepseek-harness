import { createHash } from 'node:crypto'

export const SEARCHABLE_TRACE_SCHEMA_VERSION = '1' as const
export const SEARCHABLE_TRACE_SUMMARY_MAX_LENGTH = 2_000
export const SEARCHABLE_TRACE_KIND_MAX_LENGTH = 64

export interface SearchableTraceRecordInput {
  readonly organizationId: string
  readonly projectId: string
  readonly episodeId: string
  readonly jobId: string
  readonly irId: string
  readonly runOrdinal: number
  readonly jobOutputId: string
  readonly artifactId: string
  readonly traceKind: string
  readonly summaryText: string
  readonly producerSha: string
  readonly schemaVersion?: string
}

export interface SearchableTraceRecord extends SearchableTraceRecordInput {
  readonly id: string
  readonly schemaVersion: string
}

export function searchableTraceIdFor(input: Pick<SearchableTraceRecordInput, 'organizationId' | 'irId' | 'runOrdinal'>): string {
  const digest = createHash('sha256')
    .update(`${input.organizationId}:${input.irId}:${input.runOrdinal}`)
    .digest('hex')
    .slice(0, 24)
  return `tr_${digest}`
}

function requiredText(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} is required`)
  return value.trim()
}

/** Validate the DSH-side record contract; persistence and ancestry remain external. */
export function validateSearchableTraceRecord(input: SearchableTraceRecordInput): SearchableTraceRecord {
  const record = input as unknown as Record<string, unknown>
  const allowed = new Set(['organizationId', 'projectId', 'episodeId', 'jobId', 'irId', 'runOrdinal', 'jobOutputId', 'artifactId', 'traceKind', 'summaryText', 'producerSha', 'schemaVersion'])
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw new Error(`unknown searchable trace field: ${key}`)
  const organizationId = requiredText(input.organizationId, 'organizationId')
  const projectId = requiredText(input.projectId, 'projectId')
  const episodeId = requiredText(input.episodeId, 'episodeId')
  const jobId = requiredText(input.jobId, 'jobId')
  const irId = requiredText(input.irId, 'irId')
  const runOrdinal = input.runOrdinal
  const jobOutputId = requiredText(input.jobOutputId, 'jobOutputId')
  const artifactId = requiredText(input.artifactId, 'artifactId')
  const traceKind = requiredText(input.traceKind, 'traceKind')
  const summaryText = requiredText(input.summaryText, 'summaryText')
  const producerSha = requiredText(input.producerSha, 'producerSha').toLowerCase()
  if (!Number.isInteger(input.runOrdinal) || input.runOrdinal < 0) throw new Error('runOrdinal must be non-negative')
  if (traceKind.length > SEARCHABLE_TRACE_KIND_MAX_LENGTH) throw new Error('traceKind is oversized')
  if (summaryText.length > SEARCHABLE_TRACE_SUMMARY_MAX_LENGTH) throw new Error('summaryText is oversized')
  if (!/^[0-9a-f]{7,40}$/.test(producerSha)) throw new Error('producerSha must be hexadecimal')
  const schemaVersion = input.schemaVersion?.trim() || SEARCHABLE_TRACE_SCHEMA_VERSION
  if (!/^\d+$/.test(schemaVersion)) throw new Error('schemaVersion must be numeric')
  return Object.freeze({
    id: searchableTraceIdFor({ organizationId, irId, runOrdinal }),
    organizationId,
    projectId,
    episodeId,
    jobId,
    irId,
    runOrdinal,
    jobOutputId,
    artifactId,
    traceKind,
    summaryText,
    schemaVersion,
    producerSha,
  })
}

export function assertTenantScope(organizationId: string, record: Pick<SearchableTraceRecord, 'organizationId'>): void {
  if (organizationId !== record.organizationId) throw new Error('searchable trace crosses organization boundary')
}
