/**
 * Engine-seam unit tests for @flinter/dsh-pes: the explicit configured
 * command/engine seam (engine.js) and the bounded query runner (query.js).
 *
 * Covers the required structured-result taxonomy end to end without a Loader
 * boot: provenance preservation, honest abstention, malformed-input (both
 * plugin-side semantic rejection and engine-reported per-request rejection),
 * engine-timeout, engine-nonzero-exit, engine-malformed-response,
 * engine-unavailable (unstartable command), and artifact-reference-missing.
 * Also pins bounded arguments (n range, state-array size, text length), the
 * config/env/default engine-command precedence, and deterministic equality
 * of the protocol-compatible fixture stub.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ENGINE_COMMAND,
  parseSingleResponse,
  resolveEngineArgv,
  resolveEngineConfig,
  spawnEngineQuery,
} from '../engine.js'
import {
  DEFAULT_RESULT_N,
  FIND_COUNTERFACTUALS,
  FIND_SIMILAR_STATES,
  MAX_RESULT_N,
  SEARCH_EVENTS,
  ZOOM,
  buildEngineRequest,
  runQuery,
  verifyArtifactReferences,
} from '../query.js'

const stubEngine = fileURLToPath(new URL('./fixtures/stub-engine.mjs', import.meta.url))
const failingEngine = fileURLToPath(new URL('./fixtures/failing-engine.mjs', import.meta.url))
const slowEngine = fileURLToPath(new URL('./fixtures/slow-engine.mjs', import.meta.url))
const eventsPath = fileURLToPath(new URL('./fixtures/events.jsonl', import.meta.url))
const fixturesRoot = fileURLToPath(new URL('./fixtures', import.meta.url))

const STUB_COMMAND = [process.execPath, stubEngine]
const FAST_TIMEOUT_MS = 10_000

function baseConfig(overrides = {}) {
  return {
    command: STUB_COMMAND,
    eventsPath,
    timeoutMs: FAST_TIMEOUT_MS,
    artifactsRoot: fixturesRoot,
    enginePin: undefined,
    ...overrides,
  }
}

async function queryOnce(request: Record<string, unknown>) {
  return spawnEngineQuery(
    resolveEngineArgv(STUB_COMMAND, eventsPath),
    request,
    { eventsPath, timeoutMs: FAST_TIMEOUT_MS, env: process.env },
  )
}

function engineCommand(script: string, ...extra: string[]) {
  return [process.execPath, script, ...extra]
}

async function withTempEvents(lines: string[], callback: (path: string, dir: string) => Promise<unknown>) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pes-seam-'))
  const path = join(dir, 'events.jsonl')
  try {
    await writeFile(path, `${lines.join('\n')}\n`)
    return await callback(path, dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const UNOBSERVABLE_EVENT = {
  event_id: 'u_HUMAN_iv0000', episode_id: 'u_HUMAN', t_start: 0, t_end: 1,
  state_before: null, state_after: null, transition_type: 'control',
  delta_magnitude: 0, outcome: null, outcome_source: null,
  family_hint: 'control', provenance: 'reviewer', verification: 'verified',
  source_path: null,
}

describe('dsh-pes engine seam (engine.js)', () => {
  it('spawns the configured command, writes one request line, and parses the response envelope', async () => {
    const outcome = await spawnEngineQuery(
      resolveEngineArgv(STUB_COMMAND, eventsPath),
      { mode: 'search', query: 'cup acquisition', n: 2 },
      { eventsPath, timeoutMs: FAST_TIMEOUT_MS, env: process.env },
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.response.mode).toBe('search')
    expect(outcome.response.count).toBe(2)
    expect(outcome.response.event_ids).toEqual(['u_TEST0001_cp0004', 'u_TEST0001_cp0010'])
    expect(outcome.response.abstained).toBe(false)
    expect(outcome.response.events).toHaveLength(2)
  })

  it('is deterministic across spawns for identical input', async () => {
    const request = { mode: 'search', query: 'cup acquisition', n: 2 }
    const a = await queryOnce(request)
    const b = await queryOnce(request)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('maps an engine per-request rejection to a structured malformed-input error', async () => {
    const outcome = await spawnEngineQuery(
      resolveEngineArgv(STUB_COMMAND, eventsPath),
      { mode: 'search', query: '' },
      { eventsPath, timeoutMs: FAST_TIMEOUT_MS, env: process.env },
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.kind).toBe('malformed-input')
    expect(outcome.error.engine_error).toMatch(/non-empty 'query'/)
  })

  it('maps a subprocess deadline to a structured engine-timeout error', async () => {
    const outcome = await spawnEngineQuery(
      resolveEngineArgv(engineCommand(slowEngine), eventsPath),
      { mode: 'search', query: 'slow' },
      { eventsPath, timeoutMs: 60, env: process.env },
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.kind).toBe('engine-timeout')
    expect(outcome.error.command).toEqual([...engineCommand(slowEngine), '--events', eventsPath])
  })

  it('maps a nonzero engine exit without a response to engine-nonzero-exit with stderr', async () => {
    const outcome = await spawnEngineQuery(
      resolveEngineArgv(engineCommand(failingEngine, '--exit', '2'), eventsPath),
      { mode: 'search', query: 'x' },
      { eventsPath, timeoutMs: FAST_TIMEOUT_MS, env: process.env },
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.kind).toBe('engine-nonzero-exit')
    expect(outcome.error.exit_code).toBe(2)
    expect(outcome.error.stderr).toContain('engine exploded')
  })

  it('maps an unstartable command to engine-unavailable', async () => {
    const outcome = await spawnEngineQuery(
      resolveEngineArgv(['/no/such/engine-bin'], eventsPath),
      { mode: 'search', query: 'x' },
      { eventsPath, timeoutMs: FAST_TIMEOUT_MS, env: process.env },
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.kind).toBe('engine-unavailable')
  })

  it.each([
    ['missing-envelope', /protocol/],
    ['two-lines', /one request -> one response/],
    ['bad-json', /not a JSON object line/],
  ])('maps a %s protocol violation to engine-malformed-response', async (violation, messagePattern) => {
    const outcome = await spawnEngineQuery(
      resolveEngineArgv(engineCommand(failingEngine, '--violation', violation), eventsPath),
      { mode: 'search', query: 'x' },
      { eventsPath, timeoutMs: FAST_TIMEOUT_MS, env: process.env },
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.kind).toBe('engine-malformed-response')
    expect(outcome.error.message).toMatch(messagePattern)
  })

  it('parseSingleResponse accepts exactly one JSON object line and rejects others', () => {
    expect(parseSingleResponse('{"mode":"search"}\n')).toEqual({ response: { mode: 'search' } })
    expect('problem' in parseSingleResponse('{"a":1}\n{"b":2}\n')).toBe(true)
    expect('problem' in parseSingleResponse('')).toBe(true)
    expect('problem' in parseSingleResponse('nope\n')).toBe(true)
  })

  it('resolves the engine command: config wins, then $PES_QUERY_COMMAND, then the packaged default', () => {
    expect(resolveEngineConfig({ command: ['bin', 'x'] }, {})).toMatchObject({ command: ['bin', 'x'] })
    expect(resolveEngineConfig({}, { PES_QUERY_COMMAND: JSON.stringify(['a', 'b']) })).toMatchObject({ command: ['a', 'b'] })
    expect(resolveEngineConfig({}, {})).toMatchObject({ command: DEFAULT_ENGINE_COMMAND })
    expect(() => resolveEngineConfig({}, { PES_QUERY_COMMAND: 'not-json' })).toThrow(/PES_QUERY_COMMAND/)
  })

  it('resolves events and artifact paths with config-first precedence and validates timeoutMs', () => {
    const env = { PES_EVENTS_ENRICHED_JSONL: '/env/events.jsonl', PES_ARTIFACTS_ROOT: '/env/artifacts' }
    expect(resolveEngineConfig({ events: '/cfg/events.jsonl' }, env)).toMatchObject({ eventsPath: '/cfg/events.jsonl' })
    expect(resolveEngineConfig({}, env)).toMatchObject({ eventsPath: '/env/events.jsonl', artifactsRoot: '/env/artifacts' })
    expect(resolveEngineConfig({
      timeout_ms: 123,
      artifacts_root: '/cfg/artifacts',
      engine_pin: 'c05c3fc',
    }, env)).toMatchObject({
      timeoutMs: 123,
      artifactsRoot: '/cfg/artifacts',
      enginePin: 'c05c3fc',
    })
    expect(resolveEngineConfig({}, {}).eventsPath).toBeUndefined()
    expect(() => resolveEngineConfig({ timeoutMs: 0 }, {})).toThrow(/timeoutMs/)
    expect(() => resolveEngineConfig({ command: [] }, {})).toThrow(/command/)
  })
})

describe('dsh-pes query runner (query.js)', () => {
  it('returns a bounded completed envelope with provenance for search_events', async () => {
    const result = await runQuery(SEARCH_EVENTS, { query: 'cup acquisition', n: 2 }, baseConfig())
    expect(result.status).toBe('completed')
    expect(result.tool).toBe(SEARCH_EVENTS)
    expect(result.mode).toBe('search')
    expect(result.count).toBe(2)
    expect(result.bounded).toBe(true)
    expect(result.query).toBe('cup acquisition')
    expect(result.n).toBe(2)
    expect(result.event_ids).toEqual(['u_TEST0001_cp0004', 'u_TEST0001_cp0010'])
    expect(result.artifact_verification).toBe('verified')
    expect(result.provenance.plugin).toBe('@flinter/dsh-pes')
    expect(result.provenance.engine).toBe('event_index.query')
    expect(result.provenance.engine_pin).toBeUndefined()
    // Per-event provenance passes through unchanged (canonical fields present).
    for (const event of result.events) {
      expect(typeof event.provenance).toBe('string')
      expect(typeof event.verification).toBe('string')
      expect(event.event_id).toMatch(/^u_TEST\d{4}_cp\d{4}$/)
    }
  })

  it('records the configured immutable engine pin in provenance when a deployment pins it', async () => {
    const result = await runQuery(SEARCH_EVENTS, { query: 'cup', n: 1 }, baseConfig({ enginePin: 'c05c3fc747f0aa0fcb9d0603009add71c59e091b' }))
    expect(result.provenance.engine_pin).toBe('c05c3fc747f0aa0fcb9d0603009add71c59e091b')
  })

  it('clamps output to the corpus even when n exceeds it (bounded results)', async () => {
    const result = await runQuery(SEARCH_EVENTS, { query: 'cup', n: MAX_RESULT_N }, baseConfig())
    expect(result.status).toBe('completed')
    expect(result.count).toBe(3)
  })

  it('maps an honest abstention (no annotated pre-states) to status abstained', async () => {
    await withTempEvents([JSON.stringify(UNOBSERVABLE_EVENT)], async (path) => {
      const result = await runQuery(FIND_SIMILAR_STATES, { holding: ['cup'] }, baseConfig({ eventsPath: path }))
      expect(result.status).toBe('abstained')
      expect(result.abstained).toBe(true)
      expect(result.count).toBe(0)
      expect(result.event_ids).toEqual([])
    })
  })

  it('maps an honest abstention (no outcome labels) for counterfactuals', async () => {
    await withTempEvents([JSON.stringify(UNOBSERVABLE_EVENT)], async (path) => {
      const result = await runQuery(FIND_COUNTERFACTUALS, { outcome: 'success', holding: ['cup'] }, baseConfig({ eventsPath: path }))
      expect(result.status).toBe('abstained')
      expect(result.abstained).toBe(true)
      expect(result.count).toBe(0)
    })
  })

  it('fails loud with engine-unavailable when no events index is configured', async () => {
    const result = await runQuery(SEARCH_EVENTS, { query: 'cup' }, baseConfig({ eventsPath: undefined }))
    expect(result.status).toBe('error')
    expect(result.error?.kind).toBe('engine-unavailable')
    expect(result.error?.message).toMatch(/no events index configured/)
  })

  it.each([
    ['search_events', { query: '' }, /non-empty/],
    ['search_events', { query: 'x'.repeat(2000) }, /exceeds 1024/],
    ['search_events', { query: 'cup', n: 0 }, /n must be an integer/],
    ['search_events', { query: 'cup', n: 51 }, /n must be an integer/],
    ['find_similar_states', { holding: [], on_surface: [] }, /at least one/],
    ['find_similar_states', { holding: Array.from({ length: 33 }, (_, i) => `o${i}`) }, /limited to 32/],
    ['find_counterfactuals', { outcome: '', holding: ['cup'] }, /non-empty/],
    ['zoom', { episode: 'u_TEST0001', t_start: 10, t_end: 5 }, /t_start <= t_end/],
    ['zoom', { episode: 'u_TEST0001', t_start: 1.5, t_end: 2 }, /integer/],
  ])('rejects malformed input %s %j as a structured malformed-input result', async (tool, args, pattern) => {
    const result = await runQuery(
      tool as typeof SEARCH_EVENTS | typeof FIND_SIMILAR_STATES | typeof FIND_COUNTERFACTUALS | typeof ZOOM,
      args,
      baseConfig(),
    )
    expect(result.status).toBe('error')
    expect(result.error?.kind).toBe('malformed-input')
    expect(result.error?.message).toMatch(pattern)
    expect(result.mode).toBeDefined()
  })

  it('builds engine requests per mode with sorted, deduplicated state arrays', () => {
    expect(buildEngineRequest(SEARCH_EVENTS, { query: '  cup  ', n: 1 }))
      .toEqual({ mode: 'search', request: { mode: 'search', query: 'cup', n: 1 } })
    expect(buildEngineRequest(FIND_SIMILAR_STATES, { holding: ['cup', 'cup', 'bowl'], on_surface: ['table'] }))
      .toEqual({ mode: 'similar', request: { mode: 'similar', holding: ['bowl', 'cup'], on_surface: ['table'], n: DEFAULT_RESULT_N } })
    expect(buildEngineRequest(ZOOM, { episode: 'u_TEST0001', t_start: 0, t_end: 14 }))
      .toEqual({ mode: 'zoom', request: { mode: 'zoom', episode: 'u_TEST0001', t_start: 0, t_end: 14 } })
  })

  it('verifies artifact references under the configured root and reports missing ones', () => {
    const events = [
      { event_id: 'a', source_path: 'artifacts/scan_u_TEST0001.json' },
      { event_id: 'b', source_path: 'artifacts/scan_u_GONE.json' },
      { event_id: 'escape', source_path: '../engine.js' },
      { event_id: 'c', source_path: '' },
      { event_id: 'd' },
    ]
    expect(verifyArtifactReferences(events, fixturesRoot)).toEqual({
      unconfigured: false,
      missing: [
        { event_id: 'b', source_path: 'artifacts/scan_u_GONE.json' },
        { event_id: 'escape', source_path: '../engine.js' },
      ],
    })
    expect(verifyArtifactReferences(events, undefined)).toEqual({ unconfigured: true, missing: [] })
  })

  it('fails the whole call loud as artifact-reference-missing when a returned event references a missing artifact', async () => {
    await withTempEvents([
      JSON.stringify({
        ...UNOBSERVABLE_EVENT,
        event_id: 'u_X_cp0000', episode_id: 'u_X',
        state_before: { holding: ['cup'], on_surface: [] },
        state_after: { holding: [], on_surface: ['cup'] },
        outcome: 'success', outcome_source: 'human', source_path: 'artifacts/scan_u_GONE.json',
      }),
    ], async (path) => {
      const result = await runQuery(FIND_SIMILAR_STATES, { holding: ['cup'] }, baseConfig({ eventsPath: path }))
      expect(result.status).toBe('error')
      expect(result.error?.kind).toBe('artifact-reference-missing')
      expect(result.error?.missing).toEqual([{ event_id: 'u_X_cp0000', source_path: 'artifacts/scan_u_GONE.json' }])
    })
  })
})
