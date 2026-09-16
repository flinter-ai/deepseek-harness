/**
 * Bounded, deterministic evidence memory for accepted dsh-pes traces.
 *
 * This is a retrieval seam for a future self-improvement controller. It stores
 * only the canonical trace identity, a bounded searchable projection, and
 * bounded event links. It never stores model chain-of-thought, prompts,
 * secrets, signatures, media, or the full event payload.
 */

import { createHash } from 'node:crypto'

export const REASONING_BANK_SCHEMA_VERSION = 'dsh-pes-reasoning.v1'
export const REASONING_BANK_MAX_ENTRIES = 256
export const REASONING_BANK_MAX_SUMMARY_LENGTH = 512
export const REASONING_BANK_MAX_CUE_LENGTH = 240
export const REASONING_BANK_MAX_LESSON_LENGTH = 320
export const REASONING_BANK_MAX_EVENT_IDS = 32
export const REASONING_BANK_MAX_SEARCH_RESULTS = 50

function bounded(value, max) {
  const text = String(value ?? '')
  return text.length > max ? `${text.slice(0, max - 3)}...` : text
}

function requiredString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`[dsh-pes] reasoning bank requires ${field}`)
  }
  return value
}

function validateTraceRecord(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError('[dsh-pes] reasoningEntryFor requires a TraceRecord')
  }
  requiredString(record.id, 'TraceRecord.id')
  requiredString(record.traceKind, 'TraceRecord.traceKind')
  requiredString(record.summaryText, 'TraceRecord.summaryText')
  requiredString(record.producerSha, 'TraceRecord.producerSha')
  if (!Number.isInteger(record.runOrdinal) || record.runOrdinal < 0) {
    throw new TypeError('[dsh-pes] reasoning bank requires a non-negative TraceRecord.runOrdinal')
  }
}

function validateCompletedResult(result) {
  if (result === null || typeof result !== 'object' || Array.isArray(result)
    || result.status !== 'completed' || result.abstained !== false) {
    throw new TypeError('[dsh-pes] reasoningEntryFor requires a completed, non-abstained PesResult')
  }
}

function stableId(record) {
  return `rb_${createHash('sha256').update(String(record.id)).digest('hex').slice(0, 24)}`
}

function uniqueEventIds(result) {
  if (!Array.isArray(result.event_ids)) return []
  const ids = []
  const seen = new Set()
  for (const value of result.event_ids) {
    const id = String(value)
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length === REASONING_BANK_MAX_EVENT_IDS) break
  }
  return ids
}

function cueFor(result, record, eventIds) {
  const details = []
  if (result.query !== undefined) details.push(`query=${JSON.stringify(result.query)}`)
  if (result.outcome !== undefined) details.push(`outcome=${JSON.stringify(result.outcome)}`)
  if (result.episode !== undefined) details.push(`episode=${JSON.stringify(result.episode)}`)
  if (result.state !== undefined) details.push(`state=${JSON.stringify(result.state)}`)
  const suffix = details.length > 0 ? ` ${details.join(' ')}` : ''
  return bounded(`${record.traceKind} returned ${eventIds.length} linked event(s).${suffix}`, REASONING_BANK_MAX_CUE_LENGTH)
}

function lessonFor(result, record) {
  const verification = result.artifact_verification === 'verified'
    ? 'Artifact references were verified.'
    : 'Artifact references were not configured; verify them before reuse.'
  const guidance = {
    search_events: 'Treat search matches as candidates and inspect the linked events before acting.',
    find_similar_states: 'Compare the linked transitions and provenance before reusing a similar state.',
    find_counterfactuals: 'Use the contrasting outcome as evidence and verify its state and label provenance.',
    zoom: 'Inspect the bounded episode window and linked event evidence before drawing a conclusion.',
  }[record.traceKind] ?? 'Inspect the linked event evidence before reusing this result.'
  return bounded(`${guidance} ${verification}`, REASONING_BANK_MAX_LESSON_LENGTH)
}

/** Build one entry from an accepted canonical record and its bounded result. */
export function reasoningEntryFor(record, result) {
  validateTraceRecord(record)
  validateCompletedResult(result)
  const eventIds = uniqueEventIds(result)
  return Object.freeze({
    schemaVersion: REASONING_BANK_SCHEMA_VERSION,
    id: stableId(record),
    traceId: String(record.id),
    traceKind: bounded(record.traceKind, 64),
    producerSha: bounded(record.producerSha, 64),
    runOrdinal: record.runOrdinal,
    summary: bounded(record.summaryText, REASONING_BANK_MAX_SUMMARY_LENGTH),
    cue: cueFor(result, record, eventIds),
    lesson: lessonFor(result, record),
    eventCount: Array.isArray(result.event_ids) ? result.event_ids.length : 0,
    artifactVerification: result.artifact_verification,
    evidenceIds: Object.freeze(eventIds),
  })
}

function maxEntriesFor(options) {
  const value = options.maxEntries
  if (value === undefined) return REASONING_BANK_MAX_ENTRIES
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`[dsh-pes] reasoning bank maxEntries must be an integer in [1, ${REASONING_BANK_MAX_ENTRIES}]`)
  }
  return Math.min(value, REASONING_BANK_MAX_ENTRIES)
}

/**
 * Create one process-local bank. Entries are insertion ordered and the oldest
 * entry is evicted when the configured cap is reached. Ingest is idempotent by
 * the canonical trace id, so a replay cannot create a second lesson.
 */
export function createReasoningBank(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('[dsh-pes] reasoning bank options must be an object')
  }
  const maxEntries = maxEntriesFor(options)
  const entries = new Map()

  function ingest(record, result) {
    const entry = reasoningEntryFor(record, result)
    if (!entries.has(entry.id) && entries.size >= maxEntries) {
      entries.delete(entries.keys().next().value)
    }
    entries.set(entry.id, entry)
    return entry
  }

  function list() {
    return [...entries.values()]
  }

  function search(term, limit = REASONING_BANK_MAX_SEARCH_RESULTS) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new TypeError(`[dsh-pes] reasoning bank search limit must be a positive integer <= ${REASONING_BANK_MAX_SEARCH_RESULTS}`)
    }
    const needle = String(term ?? '').trim().toLowerCase()
    if (needle === '') return list().slice(0, Math.min(limit, REASONING_BANK_MAX_SEARCH_RESULTS))
    return list()
      .filter(entry => `${entry.summary} ${entry.cue} ${entry.lesson} ${entry.traceKind} ${entry.evidenceIds.join(' ')}`.toLowerCase().includes(needle))
      .slice(0, Math.min(limit, REASONING_BANK_MAX_SEARCH_RESULTS))
  }

  return Object.freeze({ ingest, list, search, size: () => entries.size })
}
