import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { foldDecisionEpisodes } from '@deepseek-ai/dsh-decision-trace'
const childScript = fileURLToPath(new URL('./g1-crash-child.ts', import.meta.url))
const digest = (value: readonly unknown[]) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
type Mode = 'before-ack' | 'after-ack'
interface CrashChildSignal { code: number | null; signal: string | null }
interface CrashEvidence {
  beforeAck: Record<string, unknown>
  afterAck: Record<string, unknown>
  childSignals: { beforeAck: CrashChildSignal; afterAck: CrashChildSignal }
  episodes: readonly Record<string, unknown>[]
}
export interface G1CrashOutput { schema: 'flinter.g1-session-events.v1'; scope: 'local-runtime-fixture'; provenance: { harness: string; inputPath: string; inputSha256: string; node: string; persistence: string; provider: string; rootMode: 'external' }; events: readonly SessionEvent[]; persistenceAck: true; reloadEquality: { equal: boolean; liveCount: number; reloadedCount: number; liveDigest: string; reloadedDigest: string }; diagnostics: readonly string[]; session: { sessionId: string; header: unknown; events: readonly SessionEvent[] }; rawArtifact: { digest: string; byteCount: number }; crashEvidence: CrashEvidence }
async function load(root: string, id: SessionId) { const context = new Context(); await context.plugin(SessionStore); await context.plugin(JsonlSessionPersistence, { root, compression: 'none', packChunks: false }); try { return { loaded: await context.sessionPersistence.load(id), raw: await context.sessionPersistence.readRaw(id) } } finally { await context.fiber.dispose() } }
export async function loadBeforeAck(root: string, id: SessionId): Promise<{ status: 'absent' } | { status: 'loaded'; loaded: Awaited<ReturnType<typeof load>>['loaded']; raw: NonNullable<Awaited<ReturnType<typeof load>>['raw']> }> {
  const context = new Context(); await context.plugin(SessionStore); await context.plugin(JsonlSessionPersistence, { root, compression: 'none', packChunks: false })
  try {
    const raw = await context.sessionPersistence.readRaw(id)
    if (raw === undefined) return { status: 'absent' }
    return { status: 'loaded', loaded: await context.sessionPersistence.load(id), raw }
  } finally { await context.fiber.dispose() }
}
async function crash(mode: Mode, root: string, marker: string, input: string, inputSha256: string) {
  const repoRoot = resolve(dirname(childScript), '../../../..')
  const launch = resolveExampleLaunch({ srcBin: childScript, libBin: childScript, tsconfigPath: resolve(repoRoot, 'tsconfig.base.json'), sourceImport: 'tsx/esm', configArgs: [mode, root, marker, input] })
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(PATH|TMPDIR|HOME|LANG|LC_)/u.test(key) && !/(KEY|TOKEN|SECRET|PASSWORD|COOKIE)/iu.test(key)))
  const child = execa(launch.command, launch.args, { cwd: repoRoot, env: { ...inherited, ...launch.env }, extendEnv: false, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', reject: false })
  let completed = false
  const completion = child.then((result) => { completed = true; return result })
  try {
    const started = Date.now(); let parsed: Record<string, unknown> | undefined
    while (Date.now() - started < 30_000) {
      try { parsed = JSON.parse(await readFile(marker, 'utf8')) as Record<string, unknown>; break } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
      if (completed) { const result = await completion; throw new Error(`child exited before marker (${mode}): ${result.stderr.slice(0, 2000)}`) }
      await new Promise(wait => setTimeout(wait, 20))
    }
    if (!parsed) throw new Error(`marker timeout: ${mode}`)
    if (parsed.inputSha256 !== inputSha256) throw new Error(`marker input hash mismatch: ${mode}`)
    if (parsed.persistenceAck !== (mode === 'after-ack')) throw new Error(`marker persistence ack mismatch: ${mode}`)
    if (!Array.isArray(parsed.diagnostics) || parsed.diagnostics.some(item => typeof item !== 'string')) throw new Error(`marker diagnostics invalid: ${mode}`)
    if (!completed) child.kill('SIGKILL')
    const state = await completion
    const normalized = { code: state.exitCode ?? null, signal: state.signal ?? null } satisfies CrashChildSignal
    if (normalized.code !== null || normalized.signal !== 'SIGKILL') throw new Error(`unexpected child exit (${mode}): ${JSON.stringify(normalized)}`)
    const liveEvents = parsed.liveEvents
    if (!Array.isArray(liveEvents) || liveEvents.length !== 1) throw new Error(`invalid live event count: ${mode}`)
    const selection = liveEvents[0]
    if (typeof selection !== 'object' || selection === null || Array.isArray(selection)) throw new Error(`invalid live selection: ${mode}`)
    const data = (selection as Record<string, unknown>).data
    if ((selection as Record<string, unknown>).type !== 'flinter/decision-selection' || typeof data !== 'object' || data === null || Array.isArray(data) || (data as Record<string, unknown>).callId !== 'call-12' || (data as Record<string, unknown>).toolName !== 'segment.qualify') throw new Error(`unexpected live selection: ${mode}`)
    if (parsed.liveEventCount !== 1 || parsed.liveDigest !== digest(liveEvents)) throw new Error(`live event digest mismatch: ${mode}`)
    return { marker: parsed, state: normalized }
  } finally {
    if (!completed) child.kill('SIGKILL')
    await completion
  }
}
export async function runG1CrashQualification(options: { inputPath: string; outputPath: string; persistenceRoot: string }): Promise<G1CrashOutput> { if (![options.inputPath, options.outputPath, options.persistenceRoot].every(isAbsolute)) throw new TypeError('G1 crash paths must be absolute'); const bytes = await readFile(options.inputPath); const inputSha256 = sha(bytes); const input = JSON.parse(bytes.toString()) as { interrupted_session_id: string; tool_name: string; cases: Array<Record<string, unknown>>; schema?: string }; const cases = input.cases.filter(item => item.execution_group === 'crash-after-selection-ack'); const crashCase = cases[0]; if (cases.length !== 1 || crashCase === undefined || crashCase.call_id !== 'call-12' || input.tool_name !== 'segment.qualify') throw new Error('input does not contain required case-12 fixture'); try { await access(options.persistenceRoot); throw new Error('persistence root must not exist') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } await mkdir(options.persistenceRoot); const id = SessionId(input.interrupted_session_id); const beforeRoot = resolve(options.persistenceRoot, 'before'); const afterRoot = resolve(options.persistenceRoot, 'after'); await mkdir(beforeRoot); await mkdir(afterRoot); const before = await crash('before-ack', beforeRoot, resolve(options.persistenceRoot, 'before.json'), options.inputPath, inputSha256); const beforeReload = await loadBeforeAck(beforeRoot, id); if (beforeReload.status !== 'absent') throw new Error('before-ack root unexpectedly contains a session artifact'); const after = await crash('after-ack', afterRoot, resolve(options.persistenceRoot, 'after.json'), options.inputPath, inputSha256); const reloaded = await load(afterRoot, id); if (!reloaded.raw) throw new Error('missing after-ack raw artifact'); const events = reloaded.loaded.events; if (digest(events) !== String(after.marker.liveDigest) || events.length !== Number(after.marker.liveEventCount)) throw new Error('reloaded events do not match after-ack marker'); const diagnostics = [...before.marker.diagnostics as string[], ...after.marker.diagnostics as string[]]; const output: G1CrashOutput = { schema: 'flinter.g1-session-events.v1', scope: 'local-runtime-fixture', provenance: { harness: 'dsh-segmentation-decision-trace/tests/g1-crash-qualification.ts', inputPath: resolve(options.inputPath), inputSha256, node: process.version, persistence: 'jsonl-reloaded', provider: 'local-deterministic-tool-only', rootMode: 'external' }, events, persistenceAck: true, reloadEquality: { equal: digest(events) === String(after.marker.liveDigest), liveCount: Number(after.marker.liveEventCount), reloadedCount: events.length, liveDigest: String(after.marker.liveDigest), reloadedDigest: digest(events) }, diagnostics, session: { sessionId: String(input.interrupted_session_id), header: reloaded.loaded.meta, events }, rawArtifact: { digest: sha(reloaded.raw.content), byteCount: Buffer.byteLength(reloaded.raw.content) }, crashEvidence: { beforeAck: { classification: 'incomplete', marker: before.marker, reloadStatus: 'absent', reloadCount: 0 }, afterAck: { classification: 'interrupted', marker: after.marker, reloadStatus: 'durable-one-half', reloadCount: events.length }, childSignals: { beforeAck: before.state, afterAck: after.state }, episodes: foldDecisionEpisodes(events).map(episode => ({ callId: episode.callId, toolName: episode.toolName, status: episode.status, hasSelection: episode.selection !== undefined, hasResult: episode.result !== undefined })) } }; await mkdir(dirname(options.outputPath), { recursive: true }); await writeFile(options.outputPath, `${JSON.stringify(output, null, 2)}\n`); return output }
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) { const inputPath = process.env.G1_CRASH_INPUT; const outputPath = process.env.G1_CRASH_OUTPUT; const root = process.env.G1_CRASH_ROOT; if (!inputPath || !outputPath || !root) throw new Error('G1_CRASH_INPUT, G1_CRASH_OUTPUT, and G1_CRASH_ROOT are required'); const output = await runG1CrashQualification({ inputPath, outputPath, persistenceRoot: root }); console.log(`g1-crash before=incomplete after=interrupted events=${output.events.length} digest=${output.rawArtifact.digest} bytes=${output.rawArtifact.byteCount}`) }
