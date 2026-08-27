/**
 * Keyless ASSEMBLED loader smoke for @flinter/dsh-segment S1: the actual DSH
 * loader surface the worker image mounts. It assembles the real bundle patch
 * layers — @deepseek-ai/dsh-base, @deepseek-ai/dsh-headless, and the
 * @flinter/dsh-segment bundle — through loadOverlayPatches/composeEntries,
 * mirrors the composition in the test process, and boots the composed tree in
 * the driver subprocess via boot() with exactly the layered patches the dsh
 * profile launcher applies for the headless profile (the runner overlay keeps
 * the one-shot task mode inert: it would need a live model, and this smoke
 * drives the tool surface, not the task track).
 *
 * Proves on the assembled tree: plugin boot, the semantic tool call, the
 * returned structured result, deterministic artifact/provenance, invalid
 * request rejection, unknown capability rejection, and the real
 * nonzero/failure terminal path (an adapter-level non-positive-budget violation
 * surfacing as an isError result) — all without a live model or any
 * hand-crafted callback: the failing calls run through the real registered
 * tool and its real fail-closed validation.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import {
  RUN_BASELINE_PHYSICS,
  ABSTENTION_PROTOTYPE_STUB,
  DEFAULT_ARTIFACT_NAME,
} from '../capabilities/run-baseline-physics.js'

const binScript = fileURLToPath(new URL('./fixtures/segment-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/assembled-root.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const basePatchPath = fileURLToPath(new URL('../../../packages/bundle/base/cordis.patch.yml', import.meta.url))
const headlessPatchPath = fileURLToPath(new URL('../../../packages/bundle/headless/cordis.patch.yml', import.meta.url))
const segmentPatchPath = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))

const NAME = 'dsh-segment-assembled-smoke'

const S0_PRIMITIVE_TOOLS = ['frames.sample', 'track.cotracker', 'boundary.detect', 'vlm.ask', 'artifact.write']

describe('dsh-segment S1 assembled loader smoke (base + headless + segment, the worker composition)', () => {
  it('composes the real bundle layers and boots them through the Loader with the semantic capability registered and all fail-closed terminal paths proven', async () => {
    // The parent-process composition mirror: the same three real patch files
    // the driver boots, assembled exactly as the profile launcher does.
    const entries = composeEntries([
      loadOverlayPatches(NAME, basePatchPath),
      loadOverlayPatches(NAME, headlessPatchPath),
      loadOverlayPatches(NAME, segmentPatchPath),
    ])
    expect(entries.find(entry => entry.id === 'dsh-segment')).toMatchObject({ id: 'dsh-segment', name: '@flinter/dsh-segment' })

    const outDir = await mkdtemp(join(tmpdir(), 'dsh-segment-assembled-'))
    try {
      const { stdout, stderr } = await runLoaderSmoke({
        label: 'dsh-segment-assembled',
        tempDirPrefix: 'dsh-segment-assembled-',
        binScript,
        libBinScript: binScript,
        configPath,
        tsconfigPath,
        env: {
          SEGMENT_OUT_DIR: outDir,
          SEGMENT_ROSTER_MODE: 'includes',
          SEGMENT_PATCHES: [basePatchPath, headlessPatchPath, segmentPatchPath].join(delimiter),
        },
      })
      expect(stderr).toBe('')
      const lines = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
      const tools = lines.find(line => line['event'] === 'tools')
      const names = tools?.['names'] as string[]
      expect(names).toContain(RUN_BASELINE_PHYSICS)
      for (const primitive of S0_PRIMITIVE_TOOLS) {
        expect(names).not.toContain(primitive)
      }

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
      expect(first.artifact.name).toBe(DEFAULT_ARTIFACT_NAME)
      const onDisk = await readFile(join(outDir, DEFAULT_ARTIFACT_NAME), 'utf8')
      expect(createHash('sha256').update(onDisk).digest('hex')).toBe(first.artifact.content_hash)

      // Fail-closed terminal paths on the assembled tree, all real (no
      // hand-crafted callback): schema-invalid, schema non-integer,
      // adapter invalid-budget failure, unknown request key, unknown capability.
      const invalid = lines.filter(line => line['event'] === 'semantic/invalid')
      expect(invalid).toHaveLength(1)
      expect(invalid[0]?.['isError']).toBe(true)
      const schemaReject = lines.filter(line => line['event'] === 'semantic/schema-reject')
      expect(schemaReject).toHaveLength(1)
      expect(schemaReject[0]?.['isError']).toBe(true)
      expect(String(schemaReject[0]?.['error'])).toContain('invalid arguments')
      const failure = lines.filter(line => line['event'] === 'semantic/failure')
      expect(failure).toHaveLength(1)
      expect(failure[0]?.['isError']).toBe(true)
      expect(failure[0]?.['failClosed']).toBe(true)
      expect(String(failure[0]?.['error'])).toContain('fail-closed')
      expect(String(failure[0]?.['error'])).toContain('budget')
      const unknownKey = lines.filter(line => line['event'] === 'semantic/unknown-key')
      expect(unknownKey).toHaveLength(1)
      expect(unknownKey[0]?.['isError']).toBe(true)
      expect(unknownKey[0]?.['runtimeOwnsPath']).toBe(true)
      const unknown = lines.filter(line => line['event'] === 'semantic/unknown')
      expect(unknown).toHaveLength(1)
      expect(unknown[0]?.['isError']).toBe(true)
    } finally {
      await rm(outDir, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
