import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Stable schema identifier for entries retained by this package. */
export const REASONING_BANK_SCHEMA_VERSION = 'dsh-reasoning-bank.v1'
/** Maximum number of entries retained by one process-local bank. */
export const REASONING_BANK_MAX_ENTRIES = 256
/** Maximum retained summary length in UTF-16 code units. */
export const REASONING_BANK_MAX_SUMMARY_LENGTH = 512
/** Maximum retained trace identifier length. */
export const REASONING_BANK_MAX_TRACE_ID_LENGTH = 256
/** Maximum number of evidence identifiers retained for one entry. */
export const REASONING_BANK_MAX_EVIDENCE_IDS = 32
/** Maximum retained evidence identifier length. */
export const REASONING_BANK_MAX_EVIDENCE_ID_LENGTH = 240
/** Maximum number of entries returned from one search. */
export const REASONING_BANK_MAX_SEARCH_RESULTS = 50
const MAX_TRACE_KIND_LENGTH = 64
const MAX_PRODUCER_SHA_LENGTH = 64
const MAX_CUE_LENGTH = 240
const MAX_LESSON_LENGTH = 320

/** Metadata selected from one completed DSH trace. */
export interface TraceMetadata {
  readonly id: string
  readonly traceKind: string
  readonly producerSha: string
  readonly runOrdinal: number
  readonly summaryText: string
}

/** The only result state eligible for reasoning-bank retention. */
export interface AcceptedTraceResult {
  readonly status: 'completed'
  readonly abstained: false
  readonly evidenceIds?: readonly string[]
  readonly cue?: string
  readonly lesson?: string
}

/** One bounded, secret-free reasoning-bank entry. */
export interface ReasoningEntry {
  readonly schemaVersion: string
  readonly id: string
  readonly traceId: string
  readonly traceKind: string
  readonly producerSha: string
  readonly runOrdinal: number
  readonly summary: string
  readonly cue: string
  readonly lesson: string
  readonly evidenceIds: readonly string[]
}

/** Host-only service exposed by the optional Cordis plugin. */
export interface ReasoningBank {
  ingest(metadata: TraceMetadata, result: AcceptedTraceResult): ReasoningEntry
  list(): ReasoningEntry[]
  search(term?: string, limit?: number): ReasoningEntry[]
  size(): number
}

/** Plugin configuration. The bank is opt-in and process-local. */
export interface Config {
  /** Whether the optional host service should be mounted. */
  readonly enabled?: boolean
  /** Maximum number of entries retained by this process-local bank. */
  readonly maxEntries?: number
}

/** Schemastery configuration used when the plugin is loaded by DSH. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  maxEntries: z.number().step(1).min(1).max(REASONING_BANK_MAX_ENTRIES).default(REASONING_BANK_MAX_ENTRIES),
})

/** Bound a validated string without retaining an unbounded input. */
function bounded(value: string, max: number): string {
  if (value.length <= max) return value
  return max <= 3 ? value.slice(0, max) : `${value.slice(0, max - 3)}...`
}

/** Validate a required string at the API boundary. */
function required(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`reasoning-bank: ${field} must be a non-empty string`)
  }
  return value
}

/** Validate an optional text field and use its deterministic fallback when blank. */
function optionalText(value: unknown, field: string, max: number, fallback: string): string {
  if (value === undefined) return fallback
  if (typeof value === 'string' && value.trim() === '') return fallback
  const text = required(value, field)
  return bounded(text, max)
}

function validateMetadata(value: unknown): TraceMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('reasoning-bank: metadata must be an object')
  }
  const metadata = value as Partial<TraceMetadata>
  const traceId = required(metadata.id, 'id')
  const traceKind = required(metadata.traceKind, 'traceKind')
  const producerSha = required(metadata.producerSha, 'producerSha')
  const summaryText = required(metadata.summaryText, 'summaryText')
  const runOrdinal = metadata.runOrdinal
  if (typeof runOrdinal !== 'number' || !Number.isSafeInteger(runOrdinal) || runOrdinal < 0) {
    throw new TypeError('reasoning-bank: runOrdinal must be a non-negative integer')
  }
  return { id: traceId, traceKind, producerSha, runOrdinal, summaryText }
}

function validateAcceptedResult(value: unknown): AcceptedTraceResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('reasoning-bank: result must be an object')
  }
  const result = value as Partial<AcceptedTraceResult>
  if (result.status !== 'completed' || result.abstained !== false) {
    throw new TypeError('reasoning-bank: result must be completed and non-abstained')
  }
  return result as AcceptedTraceResult
}

function validateConfig(value: unknown): Config {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('reasoning-bank: config must be an object')
  }
  const config = value as Config
  const max = config.maxEntries ?? REASONING_BANK_MAX_ENTRIES
  if (!Number.isSafeInteger(max) || max < 1 || max > REASONING_BANK_MAX_ENTRIES) {
    throw new TypeError(`reasoning-bank: maxEntries must be an integer in [1, ${REASONING_BANK_MAX_ENTRIES}]`)
  }
  return config
}

function normalizeSearchTerm(value: unknown): string {
  if (value !== undefined && typeof value !== 'string') {
    throw new TypeError('reasoning-bank: search term must be a string')
  }
  return (value ?? '').trim().toLowerCase()
}

function normalizeEvidenceIds(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new TypeError('reasoning-bank: evidenceIds must be an array')
  }
  // Read only the bounded prefix. This keeps malformed or hostile oversized
  // arrays from becoming an unbounded CPU or memory input at the host seam.
  return [...new Set(value.slice(0, REASONING_BANK_MAX_EVIDENCE_IDS).map((raw, index) => {
    const id = required(raw, `evidenceIds[${index}]`).trim()
    return bounded(id, REASONING_BANK_MAX_EVIDENCE_ID_LENGTH)
  }))]
}

/** Create a bounded FIFO bank for accepted trace lessons. */
export function createReasoningBank(options: Config = {}): ReasoningBank {
  const config = validateConfig(options)
  const max = config.maxEntries ?? REASONING_BANK_MAX_ENTRIES

  const entries = new Map<string, ReasoningEntry>()
  const bank: ReasoningBank = {
    ingest(metadata, result) {
      const safeMetadata = validateMetadata(metadata)
      const safeResult = validateAcceptedResult(result)
      const traceId = safeMetadata.id
      const evidenceIds = normalizeEvidenceIds(safeResult.evidenceIds)
      const id = `rb_${createHash('sha256').update(traceId).digest('hex').slice(0, 24)}`
      const entry: ReasoningEntry = Object.freeze({
        schemaVersion: REASONING_BANK_SCHEMA_VERSION,
        id,
        traceId: bounded(traceId, REASONING_BANK_MAX_TRACE_ID_LENGTH),
        traceKind: bounded(safeMetadata.traceKind, MAX_TRACE_KIND_LENGTH),
        producerSha: bounded(safeMetadata.producerSha, MAX_PRODUCER_SHA_LENGTH),
        runOrdinal: safeMetadata.runOrdinal,
        summary: bounded(safeMetadata.summaryText, REASONING_BANK_MAX_SUMMARY_LENGTH),
        cue: optionalText(safeResult.cue, 'cue', MAX_CUE_LENGTH, `${safeMetadata.traceKind} accepted`),
        lesson: optionalText(safeResult.lesson, 'lesson', MAX_LESSON_LENGTH, 'Inspect linked evidence before reuse.'),
        evidenceIds: Object.freeze(evidenceIds),
      })
      // Map.set preserves the original position for a duplicate trace, so a
      // replacement refreshes content without turning FIFO into LRU.
      if (!entries.has(id) && entries.size >= max) {
        const oldest = entries.keys().next().value
        if (oldest !== undefined) entries.delete(oldest)
      }
      entries.set(id, entry)
      return entry
    },
    list: () => [...entries.values()],
    search: (term = '', limit = REASONING_BANK_MAX_SEARCH_RESULTS) => {
      if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new TypeError('reasoning-bank: search limit must be positive')
      }
      const needle = normalizeSearchTerm(term)
      return [...entries.values()]
        .filter(entry => !needle || `${entry.summary} ${entry.cue} ${entry.lesson} ${entry.traceKind} ${entry.evidenceIds.join(' ')}`.toLowerCase().includes(needle))
        .slice(0, Math.min(limit, REASONING_BANK_MAX_SEARCH_RESULTS))
    },
    size: () => entries.size,
  }
  return Object.freeze(bank)
}

/** Stable service key used with `ctx.provide()` and `ctx.get()`. */
export const REASONING_BANK_SERVICE = 'flinterReasoningBank'

/** Function-plugin identity for the optional host-only service. */
export const name = 'reasoning-bank'
export const inject: string[] = []

/** Mount the process-local reasoning bank when enabled. */
export function apply(ctx: Context, config: Config = {}): void {
  if (config.enabled === false) return
  ctx.provide(REASONING_BANK_SERVICE, createReasoningBank(config))
}
