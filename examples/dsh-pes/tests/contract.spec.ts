/**
 * Structured-result contract test for @flinter/dsh-pes. Simulates the
 * headless-worker-style caller that knows ONLY the tools surface: it boots
 * the real Loader composition and drives the four registered tools
 * (search_events, find_similar_states, find_counterfactuals, zoom) through
 * the engine seam, whose configured command is the protocol-compatible
 * fixture stub. Asserts the bounded result envelope: provenance (plugin +
 * engine protocol, per-event provenance unchanged), artifact verification
 * (every `source_path` resolves under the configured root), deterministic
 * echo fields, honest abstention plumbing, and every structured failure class
 * the driver exercises. The real event_index.query engine is NOT imported —
 * runtime packaging and the immutable producer pin are integration-gate work.
 *
 * Same subprocess harness as the keyless smoke; both src (tsx) and lib
 * (plain Node, DSH_EXAMPLE_MODE=lib) modes run this file.
 */

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import {
  FIND_COUNTERFACTUALS,
  FIND_SIMILAR_STATES,
  SEARCH_EVENTS,
  ZOOM,
  type PesResult,
} from '../query.js'

const binScript = fileURLToPath(new URL('./fixtures/pes-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/pes.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const stubEngine = fileURLToPath(new URL('./fixtures/stub-engine.mjs', import.meta.url))
const eventsPath = fileURLToPath(new URL('./fixtures/events.jsonl', import.meta.url))
const artifactsRoot = fileURLToPath(new URL('./fixtures', import.meta.url))

const expectedTools = [SEARCH_EVENTS, FIND_SIMILAR_STATES, FIND_COUNTERFACTUALS, ZOOM].sort()

interface Line {
  [key: string]: unknown
}

describe('dsh-pes structured-result contract (tools-surface caller)', () => {
  it('boots the plugin through the Loader and returns bounded, provenance-carrying envelopes for all four tools', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'dsh-pes-contract',
      tempDirPrefix: 'dsh-pes-contract-',
      binScript,
      libBinScript: binScript,
      configPath,
      tsconfigPath,
      env: {
        PES_QUERY_COMMAND: JSON.stringify([process.execPath, stubEngine]),
        PES_EVENTS_ENRICHED_JSONL: eventsPath,
        PES_ARTIFACTS_ROOT: artifactsRoot,
      },
    })
    expect(stderr).toBe('')
    const lines = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Line)

    // Registration shape: exactly the four tools, no phantom names.
    const tools = lines.find(line => line['event'] === 'tools')
    expect(tools?.['names']).toEqual(expectedTools)
    const schema = lines.find(line => line['event'] === 'schema')
    expect(schema?.['names']).toEqual(expectedTools)

    const results = lines.filter(line => line['event'] === 'result/ok')
    expect(results).toHaveLength(4)
    const byTool = new Map(results.map(line => [line['tool'] as string, line['value'] as PesResult]))

    const search = byTool.get(SEARCH_EVENTS)!
    expect(search.status).toBe('completed')
    expect(search.mode).toBe('search')
    expect(search.bounded).toBe(true)
    expect(search.count).toBe(2)
    expect(search.event_ids).toEqual(['u_TEST0001_cp0004', 'u_TEST0001_cp0010'])
    expect(search.query).toBe('cup acquisition')
    expect(search.n).toBe(2)
    expect(search.artifact_verification).toBe('verified')
    expect(search.abstained).toBe(false)
    expect(search.provenance.plugin).toBe('@flinter/dsh-pes')
    expect(search.provenance.engine).toBe('event_index.query')
    expect(search.provenance.engine_protocol).toBeDefined()
    expect(search.provenance.engine_pin).toBeUndefined()
    // Per-event provenance passes through unchanged.
    expect(search.events[0]?.['provenance']).toBe('scanner')
    expect(search.events[0]?.['verification']).toBe('candidate')

    const similar = byTool.get(FIND_SIMILAR_STATES)!
    expect(similar.status).toBe('completed')
    expect(similar.event_ids).toEqual(['u_TEST0001_cp0010', 'u_TEST0001_cp0004'])
    expect(similar.state).toEqual({ holding: ['cup'], on_surface: [] })

    const counterfactual = byTool.get(FIND_COUNTERFACTUALS)!
    expect(counterfactual.status).toBe('completed')
    expect(counterfactual.count).toBe(1)
    expect(counterfactual.event_ids).toEqual(['u_TEST0002_cp0006'])
    expect(counterfactual.outcome).toBe('success')
    // Events returned by an outcome-different search carry their outcome labels.
    expect(counterfactual.events[0]?.['outcome']).toBe('failure')

    const zoom = byTool.get(ZOOM)!
    expect(zoom.status).toBe('completed')
    expect(zoom.count).toBe(2)
    expect(zoom.event_ids).toEqual(['u_TEST0001_cp0004', 'u_TEST0001_cp0010'])
    expect(zoom.episode).toBe('u_TEST0001')
    expect(zoom.t_start).toBe(0)
    expect(zoom.t_end).toBe(14)

    // Schema-valid but semantically invalid zoom window: structured
    // malformed-input error result, not isError and not a silent success.
    const malformed = lines.find(line => line['event'] === 'result/error')?.['value'] as PesResult
    expect(malformed.status).toBe('error')
    expect(malformed.error?.kind).toBe('malformed-input')
    expect(malformed.error?.message).toMatch(/t_start <= t_end/)
    expect(malformed.mode).toBe('zoom')

    // Registry-level failures stay isError on the surface.
    const invalid = lines.find(line => line['event'] === 'result/invalid')
    expect(invalid?.['isError']).toBe(true)
    const unknown = lines.find(line => line['event'] === 'result/unknown')
    expect(unknown?.['isError']).toBe(true)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
