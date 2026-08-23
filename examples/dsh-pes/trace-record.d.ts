/**
 * Declarations for the pure CP searchable-trace wire-contract seam consumed by
 * the TS test surface; the runtime contract lives in trace-record.js.
 */

import type { PesResult } from './query.js'

export const TRACE_SCHEMA_VERSION: '1'
export const DEFAULT_PRODUCER_SHA: string
export const TRACE_KIND_MAX_LENGTH: 64
export const TRACE_SUMMARY_MAX_LENGTH: 2000
export const TRACE_RECORD_KEYS: readonly string[]

export interface TraceAncestryContext {
  organizationId: string
  projectId: string
  episodeId: string
  jobId: string
  irId: string
  jobOutputId: string
  artifactId: string
  runOrdinal: number
}

export interface TraceRecord {
  organizationId: string
  projectId: string
  episodeId: string
  jobId: string
  irId: string
  jobOutputId: string
  artifactId: string
  runOrdinal: number
  traceKind: string
  summaryText: string
  producerSha: string
  schemaVersion: string
  id: string
}

export function searchableTraceIdFor(input: {
  organizationId: string
  irId: string
  runOrdinal: number
}): string

export function traceKindFor(result: PesResult): string
export function summaryTextFor(result: PesResult): string

export function traceRecordFor(input: {
  context: TraceAncestryContext
  result: PesResult
  enginePin?: string
}): TraceRecord

export function serializeTraceRecord(record: TraceRecord): string
export function signTraceBody(body: string, secret: string): string
