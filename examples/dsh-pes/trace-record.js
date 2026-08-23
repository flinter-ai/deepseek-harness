/**
 * @flinter/dsh-pes CP searchable-trace record — the pure wire-contract seam.
 *
 * This module is the T1/T2 byte-equivalence seam: it owns the CANONICAL
 * serialization of the committed CP searchable-trace wire record and the
 * HMAC-SHA256 signer over the exact bytes, with no transport, no plugin
 * context, and no imports from control-plane packages or sibling
 * repositories. The CP record contract (field names, canonical key order,
 * deterministic id derivation `tr_<sha256(organizationId:irId:runOrdinal)>`
 * first 24 hex chars, numeric-string schemaVersion, hex producer SHA, bounded
 * summaryText) is re-declared here so T1's route tests and T2's emitter tests
 * can assert identical bytes for identical inputs.
 *
 * Everything in this module is a pure function of its arguments: same record
 * input always yields the same canonical bytes and the same signature.
 */

import { createHash, createHmac } from 'node:crypto'

/** The 006 record schema version (numeric string, matching the CP store). */
export const TRACE_SCHEMA_VERSION = '1'

/**
 * The engine commit reported as `producerSha` when a deployment has not
 * pinned `config.engine_pin`: the immutable searchable-trace engine SHA from
 * flinter-ai/flinter-common `feat/searchable-trace-engine`. This is always
 * the ENGINE commit — never the AWS runtime revision.
 */
export const DEFAULT_PRODUCER_SHA = 'c05c3fc747f0aa0fcb9d0603009add71c59e091b'

/** CP store bound for traceKind; the plugin emits the tool name, far below it. */
export const TRACE_KIND_MAX_LENGTH = 64

/** CP store bound for the inline searchable projection (1..2000 chars). */
export const TRACE_SUMMARY_MAX_LENGTH = 2000

/**
 * Canonical wire key order — the exact order the committed CP route and the
 * T1/T2 byte-equivalence fixtures serialize. `id` is the deterministic
 * derived id and always present on the canonical record.
 */
export const TRACE_RECORD_KEYS = [
  'organizationId',
  'projectId',
  'episodeId',
  'jobId',
  'irId',
  'jobOutputId',
  'artifactId',
  'runOrdinal',
  'traceKind',
  'summaryText',
  'producerSha',
  'schemaVersion',
  'id',
]

/**
 * Deterministic CP record id for one organization + investigation run +
 * ordinal. Same inputs always produce the same id, so CP idempotent replay
 * re-enters with the SAME id (the 006 ON CONFLICT (id) path never mints a
 * duplicate row). Mirrors the committed CP derivation byte for byte.
 * @param input - `{ organizationId, irId, runOrdinal }`.
 * @returns `tr_` + the first 24 hex chars of sha256(`org:ir:ordinal`).
 */
export function searchableTraceIdFor({ organizationId, irId, runOrdinal }) {
  const digest = createHash('sha256')
    .update(`${organizationId}:${irId}:${runOrdinal}`)
    .digest('hex')
    .slice(0, 24)
  return `tr_${digest}`
}

/**
 * Deterministic traceKind for one completed searchable-trace result: the
 * invoked tool name (bounded, searchable, and identical for identical
 * results). Abstained/error results are never eligible for emission, so no
 * kind is defined for them.
 * @param result - the completed result envelope.
 * @returns the tool name.
 */
export function traceKindFor(result) {
  return result.tool
}

/**
 * Deterministic, bounded summaryText for one completed result: a compact
 * inline projection of the returned event ids plus the tool-specific echo
 * fields, capped at the CP 2000-char summary bound. The full scientific
 * payload lives in the artifact, never here.
 * @param result - the completed result envelope.
 * @returns a non-empty, at-most-`TRACE_SUMMARY_MAX_LENGTH`-char summary.
 */
export function summaryTextFor(result) {
  const ids = Array.isArray(result?.event_ids) ? result.event_ids : []
  const parts = [`${traceKindFor(result)} returned ${ids.length} event(s)`]
  if (result?.query !== undefined) parts.push(`query=${JSON.stringify(result.query)}`)
  if (result?.state !== undefined) parts.push(`state=${JSON.stringify(result.state)}`)
  if (result?.outcome !== undefined) parts.push(`outcome=${JSON.stringify(result.outcome)}`)
  if (result?.episode !== undefined) parts.push(`episode=${JSON.stringify(result.episode)}`)
  parts.push(`events=${ids.join(',')}`)
  let text = parts.join(' ')
  if (text.length > TRACE_SUMMARY_MAX_LENGTH) {
    text = `${text.slice(0, TRACE_SUMMARY_MAX_LENGTH - 3)}...`
  }
  return text
}

/**
 * Build the canonical CP record for one completed result: runtime-owned
 * ancestry context (organization/project/episode/job/ir/jobOutput/artifact +
 * runOrdinal) combined with the deterministic search content (traceKind,
 * summaryText), provenance (producerSha = configured engine pin, else the
 * committed engine SHA) and the derived id. Every field is present; the
 * serializer then emits exactly `TRACE_RECORD_KEYS` in order.
 * @param input - `{ context, result, enginePin? }` where context carries the
 *   seven ancestry ids plus the integer runOrdinal.
 * @returns the complete canonical record object.
 */
export function traceRecordFor({ context, result, enginePin }) {
  const {
    organizationId,
    projectId,
    episodeId,
    jobId,
    irId,
    jobOutputId,
    artifactId,
    runOrdinal,
  } = context
  return {
    organizationId,
    projectId,
    episodeId,
    jobId,
    irId,
    jobOutputId,
    artifactId,
    runOrdinal,
    traceKind: traceKindFor(result),
    summaryText: summaryTextFor(result),
    producerSha: enginePin ?? DEFAULT_PRODUCER_SHA,
    schemaVersion: TRACE_SCHEMA_VERSION,
    id: searchableTraceIdFor({ organizationId, irId, runOrdinal }),
  }
}

/**
 * Canonical JSON bytes for one record: compact JSON with exactly
 * `TRACE_RECORD_KEYS` in order. The canonical record is complete — a missing
 * key fails loud rather than producing non-deterministic bytes.
 * @param record - the canonical record object.
 * @returns the UTF-8 JSON body exactly as it is signed and POSTed.
 */
export function serializeTraceRecord(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError('[dsh-pes] serializeTraceRecord expects a record object')
  }
  const ordered = {}
  for (const key of TRACE_RECORD_KEYS) {
    if (record[key] === undefined) {
      throw new TypeError(`[dsh-pes] canonical trace record is missing field ${key}`)
    }
    ordered[key] = record[key]
  }
  return JSON.stringify(ordered)
}

/**
 * HMAC-SHA256 signature over the EXACT JSON body bytes, lowercase hex — the
 * `x-webhook-signature` header convention (the CP webhook-verify convention
 * the T1 producer seam reads).
 * Pure over the bytes: same body + secret always yield the same signature.
 * @param body - the exact UTF-8 JSON bytes to sign.
 * @param secret - the runtime-owned HMAC secret.
 * @returns the lowercase hex signature string.
 */
export function signTraceBody(body, secret) {
  return createHmac('sha256', secret).update(body).digest('hex')
}
