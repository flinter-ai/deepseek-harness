/**
 * @flinter/dsh-pes runtime-owned searchable-trace emitter.
 *
 * After a COMPLETED (non-abstained) dsh-pes/search result, the plugin
 * automatically maps the result/provenance into the committed CP
 * searchable-trace wire record (trace-record.js) and POSTs the exact signed
 * bytes to the runtime-configured callback URL. This emitter is NOT a tool
 * and is never model-visible: callback URL and HMAC secret arrive only
 * through validated plugin config or the plugin-namespaced environment
 * ($PES_TRACE_*), never through tool/model request fields.
 *
 * Transport semantics, all runtime-owned:
 *
 * - At-most-once per distinct successful result in-process: a result whose
 *   deterministic content fingerprint was already emitted (or attempted) is
 *   reported `duplicate` and never re-POSTed. CP replays from other
 *   processes stay idempotent through the deterministic id.
 * - Every transport failure is classified, never thrown into the tool path:
 *   2xx `accepted`, 400 `validation-rejected`, 401 `unauthorized`,
 *   409 `conflict`, other 4xx `rejected`, 5xx/503 `unavailable`, network
 *   failure `unreachable`, unknown `unexpected`. A failed trace POST never
 *   fabricates or alters the scientific result.
 * - Emission happens ONLY for `status: 'completed'` results; abstained and
 *   error results are skipped (`skipped`), because the committed trace
 *   contract does not define their traceKind.
 * - Secrets and signatures are never printed or persisted: only the outcome
 *   status and the deterministic record id reach the logger.
 *
 * Misconfiguration fails loud at load: setting exactly one of
 * callback URL / HMAC secret, or enabling transport without the required
 * ancestry context, throws in resolveTraceConfig before any call runs.
 * Absent both URL and secret keeps the emitter disabled (no transport).
 */

import {
  DEFAULT_PRODUCER_SHA,
  serializeTraceRecord,
  signTraceBody,
  summaryTextFor,
  traceKindFor,
  traceRecordFor,
} from './trace-record.js'

export const SIGNATURE_HEADER = 'x-webhook-signature'
export const TRACE_POST_CONTENT_TYPE = 'application/json'
export const TRACE_USER_AGENT = 'dsh-pes-trace-emitter/0.1.0'
export const DEFAULT_TRACE_POST_TIMEOUT_MS = 10_000
export const MAX_TRACE_POST_TIMEOUT_MS = 60_000
export const TRACE_RUN_ORDINAL_BASE_DEFAULT = 0

/**
 * The runtime-owned ancestry/transport field resolution: plugin config key ->
 * environment variable. Config wins; the environment is the deployment-level
 * fallback. No value here ever comes from a tool/model request.
 */
export const TRACE_FIELD_ENV = Object.freeze({
  callbackUrl: ['trace_callback_url', 'PES_TRACE_CALLBACK_URL'],
  hmacSecret: ['trace_hmac_secret', 'PES_TRACE_HMAC_SECRET'],
  organizationId: ['trace_organization_id', 'PES_TRACE_ORGANIZATION_ID'],
  projectId: ['trace_project_id', 'PES_TRACE_PROJECT_ID'],
  episodeId: ['trace_episode_id', 'PES_TRACE_EPISODE_ID'],
  jobId: ['trace_job_id', 'PES_TRACE_JOB_ID'],
  irId: ['trace_ir_id', 'PES_TRACE_IR_ID'],
  jobOutputId: ['trace_job_output_id', 'PES_TRACE_JOB_OUTPUT_ID'],
  artifactId: ['trace_artifact_id', 'PES_TRACE_ARTIFACT_ID'],
  runOrdinalBase: ['trace_run_ordinal_base', 'PES_TRACE_RUN_ORDINAL_BASE'],
  postTimeoutMs: ['trace_post_timeout_ms', 'PES_TRACE_POST_TIMEOUT_MS'],
})

/** The ancestry id fields required once emission transport is enabled. */
export const TRACE_ANCESTRY_FIELDS = Object.freeze([
  'organizationId',
  'projectId',
  'episodeId',
  'jobId',
  'irId',
  'jobOutputId',
  'artifactId',
])

/**
 * Validate the plugin's trace-related config fields at load time, on the
 * config object only (environment values are validated by resolveTraceConfig).
 * Misconfiguration fails loud here, never silently at call time.
 * @param config - the plugin config object.
 * @throws TypeError on a malformed field.
 */
export function validateTraceConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('[dsh-pes] plugin config must be an object')
  }
  for (const [field, [key]] of Object.entries(TRACE_FIELD_ENV)) {
    const value = config[key]
    if (value === undefined) continue
    if (field === 'runOrdinalBase') {
      if (!isNonNegativeIntegerOrNumericString(value)) {
        throw new TypeError(`[dsh-pes] config.${key} must be a non-negative integer when set`)
      }
      continue
    }
    if (field === 'postTimeoutMs') {
      if (!Number.isInteger(value) || value < 1 || value > MAX_TRACE_POST_TIMEOUT_MS) {
        throw new TypeError(`[dsh-pes] config.${key} must be an integer in [1, ${MAX_TRACE_POST_TIMEOUT_MS}] when set`)
      }
      continue
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw new TypeError(`[dsh-pes] config.${key} must be a non-empty string when set`)
    }
  }
}

function isNonNegativeIntegerOrNumericString(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed >= 0
  }
  return false
}

function firstDefined(config, env, key, envName) {
  const fromConfig = config[key]
  if (fromConfig !== undefined) return fromConfig
  const fromEnv = env[envName]
  if (fromEnv !== undefined) return fromEnv
  return undefined
}

/**
 * Resolve the emitted record's ancestry/transport configuration: plugin
 * config wins, then the plugin-namespaced environment, then the packaged
 * defaults. Fails loud when the enabled transport is incomplete (exactly one
 * of URL/secret, or missing ancestry fields) — a partial trace wiring is a
 * misconfiguration, never a silent no-op.
 * @param config - plugin config (already shape-validated).
 * @param env - environment snapshot (process.env at load time).
 * @returns the resolved trace config; `enabled: false` when neither callback
 *   URL nor HMAC secret is configured anywhere.
 */
export function resolveTraceConfig(config, env) {
  validateTraceConfig(config)
  const resolved = {}
  for (const [field, [key, envName]] of Object.entries(TRACE_FIELD_ENV)) {
    resolved[field] = firstDefined(config, env, key, envName)
  }

  const hasUrl = resolved.callbackUrl !== undefined
  const hasSecret = resolved.hmacSecret !== undefined
  if (hasUrl !== hasSecret) {
    throw new TypeError(
      '[dsh-pes] trace_callback_url and trace_hmac_secret must be configured together '
      + '(both in plugin config or both in PES_TRACE_* environment)',
    )
  }
  if (!hasUrl) {
    return {
      enabled: false,
      callbackUrl: undefined,
      hmacSecret: undefined,
      context: undefined,
      runOrdinalBase: TRACE_RUN_ORDINAL_BASE_DEFAULT,
      postTimeoutMs: DEFAULT_TRACE_POST_TIMEOUT_MS,
    }
  }

  const callbackUrl = String(resolved.callbackUrl).trim()
  let parsedUrl
  try {
    parsedUrl = new URL(callbackUrl)
  } catch {
    throw new TypeError(`[dsh-pes] trace_callback_url must be a valid URL: ${callbackUrl}`)
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new TypeError(`[dsh-pes] trace_callback_url must be http(s), got ${parsedUrl.protocol}`)
  }

  const hmacSecret = String(resolved.hmacSecret)
  if (hmacSecret === '') {
    throw new TypeError('[dsh-pes] trace_hmac_secret must be a non-empty string')
  }

  const missingAncestry = TRACE_ANCESTRY_FIELDS.filter(field => {
    const value = resolved[field]
    return value === undefined || String(value).trim() === ''
  })
  if (missingAncestry.length > 0) {
    throw new TypeError(
      `[dsh-pes] trace emission requires ancestry context, missing: ${missingAncestry.join(', ')} `
      + '(configure trace_*_id fields or their PES_TRACE_* environment variables)',
    )
  }
  const context = {}
  for (const field of TRACE_ANCESTRY_FIELDS) {
    context[field] = String(resolved[field]).trim()
  }

  const parsedOrdinal = typeof resolved.runOrdinalBase === 'number'
    ? resolved.runOrdinalBase
    : Number(resolved.runOrdinalBase ?? TRACE_RUN_ORDINAL_BASE_DEFAULT)
  if (!Number.isInteger(parsedOrdinal) || parsedOrdinal < 0) {
    throw new TypeError('[dsh-pes] trace_run_ordinal_base must be a non-negative integer')
  }

  const parsedTimeout = resolved.postTimeoutMs === undefined
    ? DEFAULT_TRACE_POST_TIMEOUT_MS
    : Number(resolved.postTimeoutMs)
  if (!Number.isInteger(parsedTimeout) || parsedTimeout < 1 || parsedTimeout > MAX_TRACE_POST_TIMEOUT_MS) {
    throw new TypeError(`[dsh-pes] trace_post_timeout_ms must be an integer in [1, ${MAX_TRACE_POST_TIMEOUT_MS}]`)
  }

  return {
    enabled: true,
    callbackUrl,
    hmacSecret,
    context,
    runOrdinalBase: parsedOrdinal,
    postTimeoutMs: parsedTimeout,
  }
}

/**
 * Classify one transport status honestly. The four named CP failure classes
 * (400 validation, 401 auth, 409 conflict/divergent replay, 503 unavailable)
 * map exactly; other 4xx/5xx keep their failure class breadcrumb.
 * @param status - the HTTP status received, or anything else.
 * @returns the outcome status string.
 */
export function classifyTraceResponse(status) {
  if (Number.isInteger(status) && status >= 200 && status < 300) return 'accepted'
  switch (status) {
    case 400: return 'validation-rejected'
    case 401: return 'unauthorized'
    case 409: return 'conflict'
    case 503: return 'unavailable'
    default:
      break
  }
  if (Number.isInteger(status)) {
    if (status >= 400 && status < 500) return 'rejected'
    if (status >= 500) return 'unavailable'
  }
  return 'unexpected'
}

/**
 * Eligibility gate for automatic emission: ONLY a bounded completed result
 * (status `completed`, not abstained, no structured error) emits. The
 * committed trace contract defines no traceKind for abstention/error results,
 * so those are never emitted.
 * @param result - the tool result envelope.
 * @returns true when the result is eligible.
 */
export function isEligibleTraceResult(result) {
  return result !== null && typeof result === 'object'
    && result.status === 'completed'
    && result.abstained === false
}

/**
 * Deterministic content fingerprint for one eligible result: identical
 * results (same tool, same bounded summary, same producer) collapse to the
 * same fingerprint, which is what at-most-once deduplication keys on.
 * @param result - the completed result envelope.
 * @param enginePin - configured engine pin (may be undefined).
 * @returns the fingerprint string.
 */
export function resultFingerprint(result, enginePin) {
  return JSON.stringify({
    traceKind: traceKindFor(result),
    summaryText: summaryTextFor(result),
    producerSha: enginePin ?? DEFAULT_PRODUCER_SHA,
  })
}

/**
 * Default transport: POST the exact signed body to the callback URL with the
 * `x-webhook-signature` header convention (the CP webhook-verify convention; T1 producer seam reads this header)
 * (lowercase hex HMAC-SHA256 over the raw bytes), bounded by an abort
 * timeout. Network-level failures reject out of the promise.
 * @param callbackUrl - runtime-configured callback URL.
 * @param body - the exact UTF-8 JSON bytes.
 * @param signature - the lowercase hex signature for those bytes.
 * @param timeoutMs - post deadline.
 * @returns the HTTP status.
 */
export async function postTrace(callbackUrl, body, signature, timeoutMs) {
  const response = await fetch(callbackUrl, {
    method: 'POST',
    headers: {
      'content-type': TRACE_POST_CONTENT_TYPE,
      [SIGNATURE_HEADER]: signature,
      'user-agent': TRACE_USER_AGENT,
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  })
  return response.status
}

/**
 * Create one runtime-owned emitter. The emitter is created once per plugin
 * load and shared by all four tools, so per-process at-most-once semantics
 * hold across the whole composition; per distinct result it assigns the next
 * run ordinal from `runOrdinalBase` (runtime-owned, deterministic for the
 * same result sequence).
 *
 * @param options - `{ traceConfig, enginePin?, post?, logger? }`; `post` is
 *   injectable (`(callbackUrl, body, signature, timeoutMs) => Promise<status>`)
 *   for keyless transport tests, defaulting to the fetch-based postTrace.
 * @returns `{ enabled, maybeEmit }`.
 */
export function createTraceEmitter({ traceConfig, enginePin, post, logger }) {
  const enabled = traceConfig.enabled === true
  const seen = new Set()
  let ordinalCounter = traceConfig.runOrdinalBase
  const doPost = post ?? postTrace

  const log = (level, message, id) => {
    if (typeof logger?.[level] === 'function') logger[level](`[dsh-pes] trace emission ${message}`, { id })
  }

  /**
   * Automatically emit one completed result, at most once per distinct result
   * in this process. Never rejects and never throws: every outcome — skipped,
   * duplicate, accepted, or a classified transport failure — is returned and
   * logged without the body, signature, or secret.
   * @param result - the completed result envelope from the tool path.
   * @returns the emission outcome `{ status, reason?, id? }`.
   */
  async function maybeEmit(result) {
    if (!enabled) return { status: 'disabled' }
    if (!isEligibleTraceResult(result)) {
      const reason = result?.status === 'abstained' ? 'abstained' : 'error'
      return { status: 'skipped', reason }
    }
    const fingerprint = resultFingerprint(result, enginePin)
    if (seen.has(fingerprint)) return { status: 'duplicate' }
    const runOrdinal = ordinalCounter
    ordinalCounter += 1
    const record = traceRecordFor({
      context: { ...traceConfig.context, runOrdinal },
      result,
      enginePin,
    })
    const body = serializeTraceRecord(record)
    const signature = signTraceBody(body, traceConfig.hmacSecret)
    // At-most-once in-process: mark the attempt BEFORE the POST so a
    // re-presented result never re-emits, even when the transport failed.
    seen.add(fingerprint)
    let outcome
    try {
      const status = await doPost(traceConfig.callbackUrl, body, signature, traceConfig.postTimeoutMs)
      outcome = { status: classifyTraceResponse(status), id: record.id }
      log(outcome.status === 'accepted' ? 'info' : 'warn', `: ${outcome.status}`, record.id)
    } catch {
      outcome = { status: 'unreachable', id: record.id }
      log('warn', ': unreachable', record.id)
    }
    return outcome
  }

  return { enabled, maybeEmit }
}