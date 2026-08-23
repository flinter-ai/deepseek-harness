/**
 * Runtime-owned searchable-trace emitter tests for @flinter/dsh-pes: the pure
 * T1/T2 byte-equivalence seam (trace-record.js — canonical record
 * serialization, deterministic id, HMAC-SHA256 signing) and the runtime
 * emitter (trace.js — config/transport ownership, at-most-once + duplicate/
 * retry behavior, honest 400/401/409/503 classification, no emission for
 * abstained/error results, no model-selected destination). Keyless: no
 * provider, no network, no control-plane packages.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  FIND_SIMILAR_STATES,
  SEARCH_EVENTS,
  ZOOM,
  RESULT_SCHEMA_VERSION,
  runQuery,
  type PesResult,
} from '../query.js'
import {
  DEFAULT_PRODUCER_SHA,
  TRACE_RECORD_KEYS,
  TRACE_SUMMARY_MAX_LENGTH,
  searchableTraceIdFor,
  serializeTraceRecord,
  signTraceBody,
  summaryTextFor,
  traceKindFor,
  traceRecordFor,
  type TraceRecord,
} from '../trace-record.js'
import {
  SIGNATURE_HEADER,
  classifyTraceResponse,
  createTraceEmitter,
  resolveTraceConfig,
  type ResolvedTraceConfig,
} from '../trace.js'

const stubEngine = fileURLToPath(new URL('./fixtures/stub-engine.mjs', import.meta.url))
const eventsPath = fileURLToPath(new URL('./fixtures/events.jsonl', import.meta.url))
const fixturesRoot = fileURLToPath(new URL('./fixtures', import.meta.url))

const STUB_COMMAND = [process.execPath, stubEngine]

/** Fixed ancestry fixture shared with the T1/T2 byte-equivalence fixtures. */
const CONTEXT = {
  organizationId: 'org-1',
  projectId: 'proj-1',
  episodeId: 'ep-1',
  jobId: 'job-1',
  irId: 'ir-1',
  jobOutputId: 'jo-1',
  artifactId: 'art-1',
}

function traceEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PES_TRACE_CALLBACK_URL: 'https://cp.example.test/webhooks/dsh-worker/trace',
    PES_TRACE_HMAC_SECRET: 'test-secret-0',
    PES_TRACE_ORGANIZATION_ID: 'org-1',
    PES_TRACE_PROJECT_ID: 'proj-1',
    PES_TRACE_EPISODE_ID: 'ep-1',
    PES_TRACE_JOB_ID: 'job-1',
    PES_TRACE_IR_ID: 'ir-1',
    PES_TRACE_JOB_OUTPUT_ID: 'jo-1',
    PES_TRACE_ARTIFACT_ID: 'art-1',
    PES_TRACE_RUN_ORDINAL_BASE: '0',
    ...overrides,
  }
}

function resolvedConfig(env: NodeJS.ProcessEnv = traceEnv()): ResolvedTraceConfig {
  return resolveTraceConfig({}, env)
}

function completedResult(overrides: Record<string, unknown> = {}): PesResult {
  return {
    tool: SEARCH_EVENTS,
    schema_version: RESULT_SCHEMA_VERSION,
    status: 'completed',
    mode: 'search',
    count: 2,
    bounded: true,
    event_ids: ['a', 'b'],
    events: [],
    abstained: false,
    artifact_verification: 'verified',
    provenance: {
      plugin: '@flinter/dsh-pes',
      engine: 'event_index.query',
      engine_protocol: 'event_index.query stdin-jsonl v1',
    },
    query: 'cup',
    n: 2,
    ...overrides,
  }
}

function abstainedResult(): PesResult {
  return completedResult({ status: 'abstained', abstained: true, count: 0, event_ids: [] })
}

function errorResult(): PesResult {
  return completedResult({
    status: 'error',
    count: 0,
    event_ids: [],
    error: { kind: 'malformed-input', message: 'rejected' },
  })
}

function zoomResult(): PesResult {
  return {
    tool: ZOOM,
    schema_version: RESULT_SCHEMA_VERSION,
    status: 'completed',
    mode: 'zoom',
    count: 1,
    bounded: true,
    event_ids: ['z1'],
    events: [],
    abstained: false,
    artifact_verification: 'verified',
    provenance: {
      plugin: '@flinter/dsh-pes',
      engine: 'event_index.query',
      engine_protocol: 'event_index.query stdin-jsonl v1',
    },
    episode: 'ep-9',
    t_start: 0,
    t_end: 5,
    n: 1,
  }
}

const UNOBSERVABLE_EVENT = {
  event_id: 'u_HUMAN_iv0000', episode_id: 'u_HUMAN', t_start: 0, t_end: 1,
  state_before: null, state_after: null, transition_type: 'control',
  delta_magnitude: 0, outcome: null, outcome_source: null,
  family_hint: 'control', provenance: 'reviewer', verification: 'verified',
  source_path: null,
}

async function withTempEvents(lines: string[], callback: (path: string) => Promise<unknown>) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pes-trace-'))
  const path = join(dir, 'events.jsonl')
  try {
    await writeFile(path, `${lines.join('\n')}\n`)
    return await callback(path)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function fakePost(status: number) {
  const calls: Array<{ url: string; body: string; signature: string; timeoutMs: number }> = []
  const post = async (url: string, body: string, signature: string, timeoutMs: number) => {
    calls.push({ url, body, signature, timeoutMs })
    return status
  }
  return { calls, post }
}

describe('dsh-pes trace record seam (trace-record.js)', () => {
  it('derives the committed CP deterministic id (tr_ + sha256(org:ir:ordinal) first 24 hex)', () => {
    expect(searchableTraceIdFor({ organizationId: 'org-1', irId: 'ir-1', runOrdinal: 0 }))
      .toBe('tr_2ef87eec35fe7911b28138df')
    expect(searchableTraceIdFor({ organizationId: 'org-1', irId: 'ir-1', runOrdinal: 1 }))
      .not.toBe(searchableTraceIdFor({ organizationId: 'org-1', irId: 'ir-1', runOrdinal: 0 }))
  })

  it('serializes canonical bytes: fixed key order, compact JSON, exact fixture body', () => {
    const body = serializeTraceRecord(traceRecordFor({
      context: { ...CONTEXT, runOrdinal: 0 },
      result: completedResult(),
    }))
    expect(body).toBe(
      '{"organizationId":"org-1","projectId":"proj-1","episodeId":"ep-1","jobId":"job-1",'
      + '"irId":"ir-1","jobOutputId":"jo-1","artifactId":"art-1","runOrdinal":0,'
      + '"traceKind":"search_events","summaryText":"search_events returned 2 event(s) query=\\"cup\\" events=a,b",'
      + '"producerSha":"c05c3fc747f0aa0fcb9d0603009add71c59e091b","schemaVersion":"1",'
      + '"id":"tr_2ef87eec35fe7911b28138df"}',
    )
    // Key order is exactly the committed canonical order.
    expect(Object.keys(JSON.parse(body))).toEqual(TRACE_RECORD_KEYS)
  })

  it('is byte-deterministic: identical input yields identical bytes and signature', () => {
    const record = traceRecordFor({ context: { ...CONTEXT, runOrdinal: 0 }, result: completedResult() })
    expect(serializeTraceRecord(record)).toBe(serializeTraceRecord(record))
    const body = serializeTraceRecord(record)
    expect(signTraceBody(body, 'test-secret-0')).toBe(signTraceBody(body, 'test-secret-0'))
  })

  it('signs the exact bytes with HMAC-SHA256 lowercase hex (x-dsh-signature fixture)', () => {
    const record = traceRecordFor({ context: { ...CONTEXT, runOrdinal: 0 }, result: completedResult() })
    const body = serializeTraceRecord(record)
    expect(SIGNATURE_HEADER).toBe('x-dsh-signature')
    expect(signTraceBody(body, 'test-secret-0'))
      .toBe('36f5c51497e33af758d4a9ec0f7dd859748026ae6c232302f07c3ed57298c1a3')
  })

  it('maps traceKind deterministically to the invoked tool and bounds summaryText at 2000 chars', () => {
    expect(traceKindFor(completedResult())).toBe(SEARCH_EVENTS)
    expect(traceKindFor(completedResult({ tool: ZOOM }))).toBe(ZOOM)
    const long = 'e'.repeat(100)
    const many = Array.from({ length: 50 }, (_, i) => `id_${i}_${long}`)
    const text = summaryTextFor(completedResult({ event_ids: many }))
    expect(text.length).toBeLessThanOrEqual(TRACE_SUMMARY_MAX_LENGTH)
    expect(text.endsWith('...')).toBe(true)
  })

  it('uses the configured engine pin as producerSha, else the committed engine SHA', () => {
    const unpinned = traceRecordFor({ context: { ...CONTEXT, runOrdinal: 0 }, result: completedResult() })
    expect(unpinned.producerSha).toBe(DEFAULT_PRODUCER_SHA)
    const pinned = traceRecordFor({
      context: { ...CONTEXT, runOrdinal: 0 },
      result: completedResult(),
      enginePin: 'c05c3fc747f0aa0fcb9d0603009add71c59e091b',
    })
    expect(pinned.producerSha).toBe('c05c3fc747f0aa0fcb9d0603009add71c59e091b')
  })

  it('serializer fails loud on an incomplete canonical record', () => {
    expect(() => serializeTraceRecord({ organizationId: 'x' } as unknown as TraceRecord)).toThrow(/missing field/)
  })
})

describe('dsh-pes trace config ownership (trace.js)', () => {
  it('is disabled when neither callback URL nor HMAC secret is configured', () => {
    const resolved = resolveTraceConfig({}, {})
    expect(resolved.enabled).toBe(false)
    expect(resolved.callbackUrl).toBeUndefined()
  })

  it('resolves callback URL, secret, ancestry, ordinal base, and timeout from config or PES_TRACE_* env', () => {
    const resolved = resolvedConfig()
    expect(resolved.enabled).toBe(true)
    expect(resolved.callbackUrl).toBe('https://cp.example.test/webhooks/dsh-worker/trace')
    expect(resolved.hmacSecret).toBe('test-secret-0')
    expect(resolved.context).toEqual({ ...CONTEXT })
    expect(resolved.runOrdinalBase).toBe(0)
    expect(resolved.postTimeoutMs).toBe(10_000)
    // Config wins over environment.
    const viaConfig = resolveTraceConfig(
      { trace_callback_url: 'https://config.example/trace', trace_run_ordinal_base: '7' },
      traceEnv(),
    )
    expect(viaConfig.callbackUrl).toBe('https://config.example/trace')
    expect(viaConfig.runOrdinalBase).toBe(7)
  })

  it('fails loud at load on a partial or invalid transport wiring', () => {
    expect(() => resolveTraceConfig({ trace_callback_url: 'https://x.test/trace' }, {}))
      .toThrow(/configured together/)
    expect(() => resolveTraceConfig({}, { PES_TRACE_HMAC_SECRET: 'secret' }))
      .toThrow(/configured together/)
    expect(() => resolveTraceConfig({}, { PES_TRACE_CALLBACK_URL: 'not-a-url', PES_TRACE_HMAC_SECRET: 's' }))
      .toThrow(/valid URL/)
    expect(() => resolveTraceConfig(
      { trace_callback_url: 'ftp://x.test/trace', trace_hmac_secret: 's' },
      traceEnv(),
    )).toThrow(/http\(s\)/)
  })

  it('fails loud when emission transport is enabled without the ancestry context', () => {
    expect(() => resolveTraceConfig({}, {
      PES_TRACE_CALLBACK_URL: 'https://x.test/trace',
      PES_TRACE_HMAC_SECRET: 's',
    })).toThrow(/ancestry context/)
    expect(() => resolveTraceConfig({}, traceEnv({ PES_TRACE_IR_ID: '' })))
      .toThrow(/ancestry context/)
  })

  it('validates runOrdinalBase and postTimeoutMs bounds', () => {
    expect(() => resolveTraceConfig({ trace_run_ordinal_base: -1 }, traceEnv()))
      .toThrow(/non-negative integer/)
    expect(() => resolveTraceConfig({ trace_post_timeout_ms: 0 }, traceEnv()))
      .toThrow(/post_timeout_ms/)
    expect(resolveTraceConfig({ trace_post_timeout_ms: 123 }, traceEnv()).postTimeoutMs).toBe(123)
  })
})

describe('dsh-pes trace emitter (trace.js)', () => {
  it('emits a completed result automatically with the canonical signed bytes and reports accepted', async () => {
    const config = resolvedConfig()
    const { calls, post } = fakePost(200)
    const emitter = createTraceEmitter({ traceConfig: config, post })
    const outcome = await emitter.maybeEmit(completedResult())
    expect(outcome.status).toBe('accepted')
    expect(outcome.id).toBe('tr_2ef87eec35fe7911b28138df')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(config.callbackUrl)
    expect(calls[0]!.body).toBe(serializeTraceRecord(traceRecordFor({
      context: { ...CONTEXT, runOrdinal: 0 },
      result: completedResult(),
    })))
    expect(calls[0]!.signature).toBe(signTraceBody(calls[0]!.body, config.hmacSecret!))
    expect(calls[0]!.timeoutMs).toBe(config.postTimeoutMs)
  })

  it('never lets a result control the destination: transport comes only from runtime config', async () => {
    const config = resolvedConfig()
    const { calls, post } = fakePost(200)
    const emitter = createTraceEmitter({ traceConfig: config, post })
    const smuggled = completedResult({
      trace_callback_url: 'https://evil.example/trace',
      hmac_secret: 'model-chosen-secret',
    }) as PesResult
    await emitter.maybeEmit(smuggled)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(config.callbackUrl)
    expect(calls[0]!.signature).toBe(signTraceBody(calls[0]!.body, config.hmacSecret!))
    expect(calls[0]!.signature).not.toBe(signTraceBody(calls[0]!.body, 'model-chosen-secret'))
  })

  it('is at-most-once in-process: a repeated identical result is a duplicate and never re-POSTs', async () => {
    const { calls, post } = fakePost(200)
    const emitter = createTraceEmitter({ traceConfig: resolvedConfig(), post })
    const result = completedResult()
    const first = await emitter.maybeEmit(result)
    const second = await emitter.maybeEmit(result)
    expect(first.status).toBe('accepted')
    expect(second.status).toBe('duplicate')
    expect(calls).toHaveLength(1)
  })

  it('assigns a distinct deterministic run ordinal per distinct result', async () => {
    const { calls, post } = fakePost(200)
    const emitter = createTraceEmitter({ traceConfig: resolvedConfig(), post })
    await emitter.maybeEmit(completedResult())
    await emitter.maybeEmit(zoomResult())
    expect(calls).toHaveLength(2)
    expect(JSON.parse(calls[0]!.body).runOrdinal).toBe(0)
    expect(JSON.parse(calls[1]!.body).runOrdinal).toBe(1)
    expect(JSON.parse(calls[0]!.body).id).not.toBe(JSON.parse(calls[1]!.body).id)
  })

  it('does not emit for abstained or error results, and reports disabled when unconfigured', async () => {
    const { calls, post } = fakePost(200)
    const emitter = createTraceEmitter({ traceConfig: resolvedConfig(), post })
    expect(await emitter.maybeEmit(abstainedResult())).toEqual({ status: 'skipped', reason: 'abstained' })
    expect(await emitter.maybeEmit(errorResult())).toEqual({ status: 'skipped', reason: 'error' })
    const disabled = createTraceEmitter({ traceConfig: resolveTraceConfig({}, {}), post })
    expect(await disabled.maybeEmit(completedResult())).toEqual({ status: 'disabled' })
    expect(calls).toHaveLength(0)
  })

  it.each([
    [200, 'accepted'],
    [202, 'accepted'],
    [400, 'validation-rejected'],
    [401, 'unauthorized'],
    [409, 'conflict'],
    [503, 'unavailable'],
    [418, 'rejected'],
    [422, 'rejected'],
    [500, 'unavailable'],
    [502, 'unavailable'],
    ['nope', 'unexpected'],
  ])('classifies transport status %s honestly as %s', (status, expected) => {
    expect(classifyTraceResponse(status)).toBe(expected)
  })

  it('emitter-wide classification: 400/401/409/503 and network failure never throw', async () => {
    for (const status of [400, 401, 409, 503]) {
      const { calls, post } = fakePost(status)
      const emitter = createTraceEmitter({ traceConfig: resolvedConfig(), post })
      const outcome = await emitter.maybeEmit(completedResult())
      expect(outcome.status).toBe(classifyTraceResponse(status))
      expect(calls).toHaveLength(1)
    }
    const failing = createTraceEmitter({
      traceConfig: resolvedConfig(),
      post: async () => { throw new Error('connection refused') },
    })
    const outcome = await failing.maybeEmit(completedResult())
    expect(outcome.status).toBe('unreachable')
  })
})

describe('dsh-pes automatic emission through the query runner', () => {
  const baseConfig = () => ({
    command: STUB_COMMAND,
    eventsPath,
    timeoutMs: 10_000,
    artifactsRoot: fixturesRoot,
    enginePin: undefined,
  })

  it('emits exactly once per completed result and never alters it on transport failure', async () => {
    const { calls, post } = fakePost(503)
    const emitter = createTraceEmitter({ traceConfig: resolvedConfig(), post })
    const result = await runQuery(SEARCH_EVENTS, { query: 'cup acquisition', n: 2 }, baseConfig(), emitter)
    expect(result.status).toBe('completed')
    expect(calls).toHaveLength(1)
    const body = JSON.parse(calls[0]!.body) as { traceKind: string; runOrdinal: number; id: string }
    expect(body.traceKind).toBe(SEARCH_EVENTS)
    expect(body.runOrdinal).toBe(0)
    // A failed trace POST (503) classified as unavailable: the scientific
    // result is unchanged and no fabricated success is produced.
    const again = await runQuery(SEARCH_EVENTS, { query: 'cup acquisition', n: 2 }, baseConfig(), emitter)
    expect(again.status).toBe('completed')
    expect(calls).toHaveLength(1) // identical repeat deduplicated in-process
  })

  it('emits on completed results only — abstention and structured errors never emit', async () => {
    const { calls, post } = fakePost(200)
    const emitter = createTraceEmitter({ traceConfig: resolvedConfig(), post })
    await withTempEvents([JSON.stringify(UNOBSERVABLE_EVENT)], async (path) => {
      const abstained = await runQuery(
        FIND_SIMILAR_STATES, { holding: ['cup'] },
        { ...baseConfig(), eventsPath: path },
        emitter,
      )
      expect(abstained.status).toBe('abstained')
    })
    const malformed = await runQuery(ZOOM, { episode: 'u_TEST0001', t_start: 10, t_end: 5 }, baseConfig(), emitter)
    expect(malformed.status).toBe('error')
    expect(calls).toHaveLength(0)
  })

  it('leaves the existing three-argument call surface byte-identical (no emission without an emitter)', async () => {
    const plain = await runQuery(SEARCH_EVENTS, { query: 'cup acquisition', n: 2 }, baseConfig())
    expect(plain.status).toBe('completed')
    expect(JSON.stringify(plain)).toBe(JSON.stringify(await runQuery(SEARCH_EVENTS, { query: 'cup acquisition', n: 2 }, baseConfig())))
  })
})
