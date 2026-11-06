import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

const fixture = fileURLToPath(new URL('./fixtures/g1-coordinator-runtime-input.v1.json', import.meta.url))
const root = fileURLToPath(new URL('../../../../', import.meta.url))
const loader = import.meta.resolve('tsx/esm')
const safeEnv = (): NodeJS.ProcessEnv => Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/(?:key|secret|token|password|credential|auth)/iu.test(key)),
)

const launch = (script: string, env: NodeJS.ProcessEnv, sourceRoot: string) => execa(process.execPath, ['--preserve-symlinks-main', '--import', loader, join(sourceRoot, 'packages/flinter/dsh-segmentation-decision-trace/tests', script)], {
  cwd: root,
  env,
  extendEnv: false,
  reject: false,
  timeout: 30_000,
  killSignal: 'SIGTERM',
  cleanup: true,
})

const withSpaceContainingSource = async <T>(run: (sourceRoot: string, fixturePath: string, base: string) => Promise<T>): Promise<T> => {
  const base = await mkdtemp(join(tmpdir(), 'g1 cli launch '))
  const sourceRoot = join(base, 'repository with spaces')
  // This exercises source-path resolution when the repository path contains spaces.
  await symlink(root, sourceRoot, process.platform === 'win32' ? 'junction' : 'dir')
  return run(sourceRoot, join(sourceRoot, 'packages/flinter/dsh-segmentation-decision-trace/tests/fixtures/g1-coordinator-runtime-input.v1.json'), base).finally(() => rm(base, { recursive: true, force: true }))
}

describe('G1 qualification CLI launch', () => {
  it('writes a full report when the source path contains spaces', async () => withSpaceContainingSource(async (sourceRoot, input, base) => {
    const output = join(base, 'full report.json')
    const result = await launch('g1-full-qualification.ts', { ...safeEnv(), G1_FULL_INPUT: input, G1_FULL_OUTPUT: output, G1_FULL_PERSISTENCE_ROOT: join(base, 'full persist') }, sourceRoot)
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(await readFile(output, 'utf8')).schema).toBe('flinter.g1-session-events.v1')
  }), 30_000)

  it.skipIf(process.platform === 'win32')('writes a crash report when the source path contains spaces', async () => withSpaceContainingSource(async (sourceRoot, input, base) => {
    const output = join(base, 'crash report.json')
    const result = await launch('g1-crash-qualification.ts', { ...safeEnv(), G1_CRASH_INPUT: input, G1_CRASH_OUTPUT: output, G1_CRASH_ROOT: join(base, 'crash persist') }, sourceRoot)
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(await readFile(output, 'utf8')).schema).toBe('flinter.g1-session-events.v1')
  }), 30_000)

  it.each([
    ['g1-full-qualification.ts', 'G1_FULL_OUTPUT', 'G1_FULL_INPUT, G1_FULL_OUTPUT, and G1_FULL_PERSISTENCE_ROOT are required'],
    ['g1-crash-qualification.ts', 'G1_CRASH_OUTPUT', 'G1_CRASH_INPUT, G1_CRASH_OUTPUT, and G1_CRASH_ROOT are required'],
  ])('rejects missing required env for %s', async (script, missing, message) => {
    const env: NodeJS.ProcessEnv = { ...safeEnv(), G1_FULL_INPUT: fixture, G1_FULL_OUTPUT: '/tmp/unused', G1_FULL_PERSISTENCE_ROOT: '/tmp/unused-root', G1_CRASH_INPUT: fixture, G1_CRASH_OUTPUT: '/tmp/unused', G1_CRASH_ROOT: '/tmp/unused-root' }
    env[missing] = undefined
    const result = await launch(script, env, root)
    expect(result.exitCode).not.toBe(0); expect(result.stderr).toContain(message)
  }, 45_000)
})
