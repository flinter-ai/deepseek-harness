import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import Sqlite from '@deepseek-ai/dsh-session-persistence-sqlite'
import { describe, expect, it, vi } from 'vitest'
import { decodeSessionEventArchiveSegmentV1, encodeSessionEventArchiveSegmentV1 } from '../src/archive-segment.ts'
import type { SessionArchiveEvent, SessionArchivePage, SessionArchiveSnapshot } from '../src/archive.ts'

const repoRoot = join(import.meta.dirname, '../../../..')
const fixture = join(import.meta.dirname, 'fixtures/archive-crash-child.ts')

describe.skipIf(process.platform === 'win32')('archive checkpoint after writer SIGKILL', () => {
  it.each(['jsonl', 'sqlite'] as const)('resumes the exact prefix on %s', async (backend) => {
    const root = await mkdtemp(join(tmpdir(), `dsh-archive-crash-${backend}-`))
    const child = execa(process.execPath, ['--import', 'tsx/esm', fixture, backend, root], {
      cwd: repoRoot,
      env: { TSX_TSCONFIG_PATH: join(repoRoot, 'tsconfig.base.json') },
      reject: false,
    })
    const ctx = new Context()
    try {
      await vi.waitFor(async () => {
        expect(await readFile(join(root, 'ready'), 'utf8')).toBe('checkpoint-and-suffix-written')
      }, { timeout: 20_000, interval: 25 })
      child.kill('SIGKILL')
      const exit = await child
      expect(exit.signal, exit.stderr).toBe('SIGKILL')
      const { snapshot, first, expected } = JSON.parse(await readFile(join(root, 'checkpoint.json'), 'utf8')) as {
        snapshot: SessionArchiveSnapshot
        first: SessionArchivePage
        expected: SessionArchiveEvent[]
      }
      await ctx.plugin(SessionStore)
      if (backend === 'jsonl') await ctx.plugin(Jsonl, { root, compression: 'none' })
      else await ctx.plugin(Sqlite, { path: join(root, 'sessions.db') })
      const events = [...first.events]
      let cursor = first.nextAfterSeq
      for (let count = 0; cursor !== null && count < expected.length; count++) {
        const page = await ctx.sessionPersistence.readArchiveSnapshotPage(snapshot, cursor, 1)
        expect(page.events.length).toBeLessThanOrEqual(1)
        expect(page.sourceRevision).toBe(snapshot.sourceRevision)
        if (page.nextAfterSeq !== null) expect(page.nextAfterSeq).toBeGreaterThan(cursor)
        events.push(...page.events)
        cursor = page.nextAfterSeq
      }
      expect(cursor).toBeNull()
      expect(events).toEqual(expected)
      expect(decodeSessionEventArchiveSegmentV1(
        encodeSessionEventArchiveSegmentV1(snapshot, events),
      ).events).toEqual(expected)
      expect((await ctx.sessionPersistence.beginArchiveSnapshot(snapshot.sessionId))?.highWatermarkSeq).toBe(3)
    } finally {
      child.kill('SIGKILL')
      await child
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
