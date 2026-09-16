import type { PesResult } from './query.js'
import type { TraceRecord } from './trace-record.js'
export const REASONING_BANK_SCHEMA_VERSION: 'dsh-pes-reasoning.v1'
export const REASONING_BANK_MAX_ENTRIES: 256
export const REASONING_BANK_MAX_SUMMARY_LENGTH: 512
export const REASONING_BANK_MAX_CUE_LENGTH: 240
export const REASONING_BANK_MAX_LESSON_LENGTH: 320
export const REASONING_BANK_MAX_EVENT_IDS: 32
export const REASONING_BANK_MAX_SEARCH_RESULTS: 50
export interface ReasoningEntry {
  schemaVersion: 'dsh-pes-reasoning.v1'
  id: string
  traceId: string
  traceKind: string
  producerSha: string
  runOrdinal: number
  summary: string
  cue: string
  lesson: string
  eventCount: number
  artifactVerification: 'verified' | 'unconfigured'
  evidenceIds: readonly string[]
}
export function reasoningEntryFor(record: TraceRecord, result: PesResult): ReasoningEntry
export interface ReasoningBank {
  ingest(record: TraceRecord, result: PesResult): ReasoningEntry
  list(): ReasoningEntry[]
  search(term: string, limit?: number): ReasoningEntry[]
  size(): number
}
export function createReasoningBank(options?: { maxEntries?: number }): ReasoningBank
