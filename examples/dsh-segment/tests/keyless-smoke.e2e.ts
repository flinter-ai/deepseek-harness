/**
 * Keyless loader smoke for the @flinter/dsh-segment S0 bundle: boots a real
 * Cordis Loader tree from the checked-in segment.cordis.yml composition
 * (tools service + system prompt + the segment bundle), asserts all five stub
 * tools registered with stable schemas, calls each tool twice, and expects
 * schema-valid deterministic results and a clean exit. No TowerH, TowerT,
 * VLM, B2, or live provider — the worker boot → tool call → artifact write
 * path.
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

const binScript = fileURLToPath(new URL('./fixtures/segment-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/segment.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

describe('dsh-segment S0 keyless loader smoke', () => {
  it('boots the plugin through the Loader, validates schemas, and returns deterministic stub results', async () => {
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
        inspect: async () => {
          const onDisk = await readFile(join(outDir, 'segments.json'), 'utf8')
          expect(JSON.parse(onDisk)).toEqual({ segments: [1, 2, 3] })
        },
      })
      expect(stderr).toBe('')
      const lines = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
      const tools = lines.find(line => line['event'] === 'tools')
      const expected = ['artifact.write', 'boundary.detect', 'frames.sample', 'track.cotracker', 'vlm.ask']
      expect(tools?.['names']).toEqual(expected)
      const results = lines.filter(line => line['event'] === 'tool/result')
      expect(results.map(result => result['name']).sort()).toEqual(expected)
      for (const result of results) {
        expect(result['isError']).toBe(false)
        const value = result['value'] as { artifact: unknown; content_hash: string }
        expect(value.content_hash).toMatch(/^[0-9a-f]{64}$/)
        // artifact.write hashes the serialized payload it wrote, not the
        // returned { path, name } descriptor; the other four stubs hash the
        // artifact descriptor itself, so recomputation differs per tool.
        const expectedHash = result['name'] === 'artifact.write'
          ? createHash('sha256').update(JSON.stringify({ segments: [1, 2, 3] }, null, 2)).digest('hex')
          : createHash('sha256').update(JSON.stringify(value.artifact)).digest('hex')
        expect(value.content_hash).toBe(expectedHash)
      }
      const schemas = lines.filter(line => line['event'] === 'schema')
      expect(schemas).toHaveLength(expected.length)
    } finally {
      await rm(outDir, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
