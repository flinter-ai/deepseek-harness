/**
 * Keyless loader smoke for the @flinter/dsh-pes bundle: boots a real Cordis
 * Loader tree from the checked-in pes.cordis.yml composition (tools service +
 * system prompt + the dsh-pes bundle) with the engine seam filled by the
 * protocol-compatible fixture stub ($PES_QUERY_COMMAND), asserts the
 * registration shape — exactly the four tools — calls each tool twice, and
 * expects schema-valid deterministic bounded envelopes with provenance and
 * verified artifact references, plus a clean exit. The real event_index.query
 * engine is never imported: only the explicit configured command seam is
 * exercised; packaging the engine and pinning its immutable SHA are
 * integration-gate work.
 *
 * Follows the headless-agent keyless-smoke convention: the fixture driver
 * runs as a subprocess under tsx with the root tsconfig paths facade, so bare
 * `@deepseek-ai/*` imports in the driver and the plugin resolve to source.
 */

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import {
  FIND_COUNTERFACTUALS,
  FIND_SIMILAR_STATES,
  SEARCH_EVENTS,
  ZOOM,
} from '../query.js'

const binScript = fileURLToPath(new URL('./fixtures/pes-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/pes.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const stubEngine = fileURLToPath(new URL('./fixtures/stub-engine.mjs', import.meta.url))
const eventsPath = fileURLToPath(new URL('./fixtures/events.jsonl', import.meta.url))
const artifactsRoot = fileURLToPath(new URL('./fixtures', import.meta.url))

describe('dsh-pes keyless loader smoke', () => {
  it('boots the plugin through the Loader with exactly the four tools and bounded provenance-carrying results', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'dsh-pes',
      tempDirPrefix: 'dsh-pes-smoke-',
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
    const lines = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    const tools = lines.find(line => line['event'] === 'tools')
    expect(tools?.['names']).toEqual([SEARCH_EVENTS, FIND_SIMILAR_STATES, FIND_COUNTERFACTUALS, ZOOM].sort())

    const results = lines.filter(line => line['event'] === 'result/ok')
    expect(results).toHaveLength(4)
    for (const line of results) {
      const value = line['value'] as { status: string; bounded: boolean; count: number; artifact_verification: string; provenance: { plugin: string } }
      expect(value.status).toBe('completed')
      expect(value.bounded).toBe(true)
      expect(value.count).toBeGreaterThan(0)
      expect(value.artifact_verification).toBe('verified')
      expect(value.provenance.plugin).toBe('@flinter/dsh-pes')
    }

    // Schema-violating and unknown calls fail loud on the surface.
    const invalid = lines.find(line => line['event'] === 'result/invalid')
    expect(invalid?.['isError']).toBe(true)
    const unknown = lines.find(line => line['event'] === 'result/unknown')
    expect(unknown?.['isError']).toBe(true)
    // Structured error path exercised by the driver (semantically invalid zoom).
    const malformed = lines.find(line => line['event'] === 'result/error')?.['value'] as { status: string; error: { kind: string } }
    expect(malformed.status).toBe('error')
    expect(malformed.error.kind).toBe('malformed-input')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
