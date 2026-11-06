import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { loadBeforeAck, runG1CrashQualification } from './g1-crash-qualification.ts'
const inputPath = fileURLToPath(new URL('./fixtures/g1-coordinator-runtime-input.v1.json', import.meta.url))
const inputSha = 'bbe385a9a89f2c9b4a749ddc8b00b71855cf8a66c1d4aa724e77f9836c19d6be'
describe.skipIf(process.platform === 'win32')('G1 hard crash qualification', () => {
  it('records durable crash boundaries from coordinator input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'g1-crash-'))
    try {
      const outputPath = join(root, 'output.json')
      const out = await runG1CrashQualification({ inputPath, outputPath, persistenceRoot: join(root, 'persist') })
      expect(out.provenance.inputSha256).toBe(inputSha)
      expect(out.crashEvidence.childSignals.beforeAck).toEqual({ code: null, signal: 'SIGKILL' })
      expect(out.crashEvidence.childSignals.afterAck).toEqual({ code: null, signal: 'SIGKILL' })
      expect(out.crashEvidence.childSignals.beforeAck.signal).toBe('SIGKILL')
      expect(out.crashEvidence.childSignals.afterAck.signal).toBe('SIGKILL')
      expect(out.crashEvidence.beforeAck).toMatchObject({ classification: 'incomplete', reloadStatus: 'absent', reloadCount: 0, marker: { persistenceAck: false } })
      expect(out.crashEvidence.afterAck).toMatchObject({ classification: 'interrupted', reloadStatus: 'durable-one-half', reloadCount: 1, marker: { persistenceAck: true } })
      const beforeMarker = out.crashEvidence.beforeAck.marker as { liveEvents: readonly unknown[]; liveDigest: string }
      const afterMarker = out.crashEvidence.afterAck.marker as { liveEvents: readonly unknown[]; liveDigest: string }
      const expectedDigest = (events: readonly unknown[]) => createHash('sha256').update(JSON.stringify(events)).digest('hex')
      expect(beforeMarker.liveEvents).toHaveLength(1)
      expect(afterMarker.liveEvents).toHaveLength(1)
      expect(beforeMarker.liveEvents[0]).toMatchObject({ type: 'flinter/decision-selection', data: { callId: 'call-12', toolName: 'segment.qualify' } })
      const withoutTime = (event: unknown) => {
        if (!event || typeof event !== 'object') return event
        const { time: _time, ...stable } = event as Record<string, unknown>
        return stable
      }
      expect(withoutTime(afterMarker.liveEvents[0])).toEqual(withoutTime(beforeMarker.liveEvents[0]))
      expect(beforeMarker.liveDigest).toBe(expectedDigest(beforeMarker.liveEvents))
      expect(afterMarker.liveDigest).toBe(expectedDigest(afterMarker.liveEvents))
      expect(beforeMarker).toHaveProperty('diagnostics')
      expect(afterMarker).toHaveProperty('diagnostics')
      expect(afterMarker.liveEvents).toEqual(out.events)
      expect(out.events[0]).toMatchObject({ type: 'flinter/decision-selection', data: { callId: 'call-12', toolName: 'segment.qualify' } })
      expect(out.events.filter(event => event.type === 'flinter/decision-selection')).toHaveLength(1)
      expect(out.events.filter(event => event.type === 'flinter/decision-result')).toHaveLength(0)
      expect(out.reloadEquality).toMatchObject({ equal: true, liveCount: 1, reloadedCount: 1 })
      expect(out.rawArtifact.byteCount).toBeGreaterThan(0)
      expect(out.rawArtifact.digest).toMatch(/^[a-f0-9]{64}$/u)
      expect(JSON.parse(await readFile(outputPath, 'utf8')).schema).toBe('flinter.g1-session-events.v1')
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 45_000)

  it('rejects malformed before-ack persistence instead of classifying absence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'g1-crash-malformed-'))
    const ctx = new Context()
    const id = SessionId('g1-malformed-before')
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none', packChunks: false })
      const location = ctx.sessionPersistence.locate({ id, version: 1, createdAt: Date.now(), cwd: process.cwd(), delegationDepth: 0 })
      if (location === undefined) throw new Error('JSONL persistence did not provide an artifact location')
      await mkdir(dirname(location.path), { recursive: true })
      await writeFile(location.path, '{"type":"session","version":1,"id":"g1-malformed-before","createdAt":1,"delegationDepth":0}\n{"type":"event"}\n')
      await expect(loadBeforeAck(root, id)).rejects.toThrow(/corrupt|invalid|event|JSON|log format|newer harness/u)
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  })

  it('surfaces child schema failure and invalid launch mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'g1-crash-invalid-'))
    const badInput = join(root, 'bad.json'); const outputPath = join(root, 'output.json'); const persist = join(root, 'persist')
    try {
      const fixture = JSON.parse(await readFile(inputPath, 'utf8')); fixture.schema = 'invalid.fixture.schema'; await writeFile(badInput, JSON.stringify(fixture))
      await expect(runG1CrashQualification({ inputPath: badInput, outputPath, persistenceRoot: persist }))
        .rejects.toThrow(/invalid G1 input schema/)
      const previous = process.env.DSH_EXAMPLE_MODE
      process.env.DSH_EXAMPLE_MODE = 'invalid'
      try { await expect(runG1CrashQualification({ inputPath, outputPath, persistenceRoot: join(root, 'persist-mode') })).rejects.toThrow(/mode|invalid/u) } finally { if (previous === undefined) delete process.env.DSH_EXAMPLE_MODE; else process.env.DSH_EXAMPLE_MODE = previous }
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
