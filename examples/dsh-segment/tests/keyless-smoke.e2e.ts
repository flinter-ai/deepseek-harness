/**
 * Keyless loader smoke for the @flinter/dsh-segment S1 bundle: boots a real
 * Cordis Loader tree from the checked-in segment.cordis.yml composition (tools
 * service + system prompt + the segment bundle), asserts the new registration
 * shape — exactly one registered tool, RUN_BASELINE_PHYSICS, with no S0
 * prototype tool names exposed — calls the semantic surface twice, and expects
 * schema-valid deterministic results with an explicit abstention marker and a
 * clean exit. The written stub artifact's bytes must hash to the recorded
 * artifact content hash. No TowerH, TowerT, VLM, B2, or live provider — the
 * worker boot → semantic capability → artifact write path.
 *
 * Follows the headless-agent keyless-smoke convention: the fixture driver
 * runs as a subprocess under tsx with the root tsconfig paths facade, so bare
 * `@deepseek-ai/*` imports in the driver and the plugin resolve to source.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import {
  RUN_BASELINE_PHYSICS,
  ABSTENTION_PROTOTYPE_STUB,
  DEFAULT_ARTIFACT_NAME,
} from '../capabilities/run-baseline-physics.js'

const binScript = fileURLToPath(new URL('./fixtures/segment-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/segment.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

describe('dsh-segment S1 keyless loader smoke', () => {
  it('boots the plugin through the Loader with only the semantic capability registered and writes the stub artifact', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'dsh-segment-smoke-'))
    try {
      const { stdout, stderr } = await runLoaderSmoke({
        label: 'dsh-segment',
        tempDirPrefix: 'dsh-segment-smoke-',
        binScript,
        libBinScript: binScript,
        configPath,
        tsconfigPath,
        env: { SEGMENT_OUT_DIR: outDir },
      })
      expect(stderr).toBe('')
      const lines = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
      const tools = lines.find(line => line['event'] === 'tools')
      expect(tools?.['names']).toEqual([RUN_BASELINE_PHYSICS])
      const schemas = lines.filter(line => line['event'] === 'schema')
      expect(schemas).toHaveLength(1)
      expect(schemas[0]?.['name']).toBe(RUN_BASELINE_PHYSICS)
      const results = lines.filter(line => line['event'] === 'semantic/result')
      expect(results).toHaveLength(2)
      const first = results[0]?.['value'] as { abstention: string; content_hash: string; artifact: { name: string; content_hash: string } }
      const second = results[1]?.['value']
      expect(second).toEqual(first)
      expect(first.abstention).toBe(ABSTENTION_PROTOTYPE_STUB)
      expect(first.content_hash).toMatch(/^[0-9a-f]{64}$/)
      // The written artifact's bytes hash to the recorded artifact content hash.
      expect(first.artifact.name).toBe(DEFAULT_ARTIFACT_NAME)
      const onDisk = await readFile(join(outDir, DEFAULT_ARTIFACT_NAME), 'utf8')
      expect(createHash('sha256').update(onDisk).digest('hex')).toBe(first.artifact.content_hash)
      const invalid = lines.filter(line => line['event'] === 'semantic/invalid')
      expect(invalid).toHaveLength(1)
      expect(invalid[0]?.['isError']).toBe(true)
    } finally {
      await rm(outDir, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
