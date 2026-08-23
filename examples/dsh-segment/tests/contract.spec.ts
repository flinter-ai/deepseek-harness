/**
 * Semantic-capability contract test for @flinter/dsh-segment S1. Simulates an
 * aws-runtime-style caller that knows ONLY the semantic interface: it boots
 * the real Loader composition and drives the single registered capability
 * RUN_BASELINE_PHYSICS through the tools surface, never touching the internal
 * prototype primitives. Asserts the typed result envelope: provenance,
 * explicit abstention marker, schema-derived content hashes, and the written
 * artifact payload hashing to the recorded artifact content hash. Also pins
 * the registry mechanics (exactly one capability; unknown ids fail loud;
 * disposer removes).
 *
 * Same subprocess harness as the keyless smoke; both src (tsx) and lib (plain
 * Node, DSH_EXAMPLE_MODE=lib) modes run this file.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { createCapabilityRegistry, type CapabilityAdapter } from '../capabilities/registry.js'
import {
  RUN_BASELINE_PHYSICS,
  RUN_BASELINE_PHYSICS_RESULT_SCHEMA_VERSION,
  ABSTENTION_PROTOTYPE_STUB,
  DEFAULT_ARTIFACT_NAME,
} from '../capabilities/run-baseline-physics.js'

const binScript = fileURLToPath(new URL('./fixtures/segment-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/segment.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

interface SemanticEnvelope {
  capability_id: string
  schema_version: string
  status: string
  abstention: string
  provenance: {
    plugin: string
    milestone: string
    stages: Array<{ stage: string; content_hash: string }>
  }
  output: Record<string, unknown>
  artifact: { name: string; content_hash: string }
  content_hash: string
}

describe('dsh-segment S1 semantic-capability contract (aws-runtime-style caller)', () => {
  it('drives the registered capability through only the semantic surface and returns a typed, abstained, hash-consistent result', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'dsh-segment-contract-'))
    try {
      const { stdout, stderr } = await runLoaderSmoke({
        label: 'dsh-segment-contract',
        tempDirPrefix: 'dsh-segment-contract-',
        binScript,
        libBinScript: binScript,
        configPath,
        tsconfigPath,
        env: { SEGMENT_OUT_DIR: outDir },
      })
      expect(stderr).toBe('')
      const lines = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)

      // Rule 1/2: exactly ONE registered capability; no S0 prototype tool
      // names linger on the public surface, and no phantom list exists.
      const tools = lines.find(line => line['event'] === 'tools')
      expect(tools?.['names']).toEqual([RUN_BASELINE_PHYSICS])
      const schemas = lines.filter(line => line['event'] === 'schema')
      expect(schemas).toHaveLength(1)

      // Typed result: two deterministic calls, envelope fields, provenance.
      const results = lines.filter(line => line['event'] === 'semantic/result')
      expect(results).toHaveLength(2)
      const first = results[0]?.['value'] as SemanticEnvelope
      const second = results[1]?.['value'] as SemanticEnvelope
      expect(second).toEqual(first)
      expect(first.capability_id).toBe(RUN_BASELINE_PHYSICS)
      expect(first.schema_version).toBe(RUN_BASELINE_PHYSICS_RESULT_SCHEMA_VERSION)
      expect(first.status).toBe('completed')
      expect(first.abstention).toBe(ABSTENTION_PROTOTYPE_STUB)
      expect(first.provenance.plugin).toBe('@flinter/dsh-segment')
      expect(first.provenance.milestone).toBe('S1')
      const stages = first.provenance.stages
      expect(stages.map(stage => stage.stage)).toEqual([
        'frames.sample',
        'track.cotracker',
        'boundary.detect',
        'artifact.write',
      ])
      for (const stage of stages) {
        expect(stage.content_hash).toMatch(/^[0-9a-f]{64}$/)
      }

      // content_hash consistency: sha256 over canonical JSON of every other field.
      expect(first.content_hash).toMatch(/^[0-9a-f]{64}$/)
      const { content_hash: envelopeHash, ...rest } = first
      expect(createHash('sha256').update(JSON.stringify(rest)).digest('hex')).toBe(envelopeHash)

      // Artifact payload with a matching sha256 content_hash: the envelope's
      // artifact hash equals the artifact.write stage hash and the on-disk bytes.
      expect(first.artifact.name).toBe(DEFAULT_ARTIFACT_NAME)
      expect(first.artifact.content_hash).toBe(stages[3]!.content_hash)
      const onDisk = await readFile(join(outDir, DEFAULT_ARTIFACT_NAME), 'utf8')
      expect(createHash('sha256').update(onDisk).digest('hex')).toBe(first.artifact.content_hash)

      // Nothing beyond the one capability looks callable: invalid input and an
      // unknown capability name both fail loud on the surface.
      const invalid = lines.filter(line => line['event'] === 'semantic/invalid')
      expect(invalid).toHaveLength(1)
      expect(invalid[0]?.['isError']).toBe(true)
      const unknown = lines.filter(line => line['event'] === 'semantic/unknown')
      expect(unknown).toHaveLength(1)
      expect(unknown[0]?.['isError']).toBe(true)
    } finally {
      await rm(outDir, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS) // eslint-disable-line no-magic-numbers
})

describe('dsh-segment S1 capability registry', () => {
  it('registers one id, lists only it, fails loud on unknown ids, and disposes', () => {
    const registry = createCapabilityRegistry()
    const adapter = { execute: (request: { window: string }) => ({ window: request.window }) }
    const disposer = registry.register('CAP_PROBE', adapter)
    expect(registry.has('CAP_PROBE')).toBe(true)
    expect(registry.list()).toEqual(['CAP_PROBE'])
    expect(registry.execute('CAP_PROBE', { window: 't0-t1' })).toEqual({ window: 't0-t1' })
    disposer()
    expect(registry.has('CAP_PROBE')).toBe(false)
    expect(registry.list()).toEqual([])
    expect(() => registry.execute('CAP_PROBE', { window: 't0-t1' })).toThrow(/unknown capability/)
    expect(() => registry.execute('CAP_PHANTOM', {})).toThrow(/unknown capability/)
  })

  it('rejects duplicate registration and adapters without execute', () => {
    const registry = createCapabilityRegistry()
    registry.register('CAP_DUP', { execute: () => 'ok' })
    expect(() => registry.register('CAP_DUP', { execute: () => 'ok' })).toThrow(/already registered/)
    // The runtime rejects a malformed adapter; TS cannot express "an object
    // that type-checks as an adapter but lacks execute", so cast deliberately.
    const malformed = {} as unknown as CapabilityAdapter<unknown, unknown>
    expect(() => registry.register('CAP_NO_EXECUTE', malformed)).toThrow(/adapter with an execute/)
  })
})
