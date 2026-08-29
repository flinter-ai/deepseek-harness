import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  buildDshAttemptLaunch,
  buildWorkerAttemptManifest,
  cleanupWorkerAttempt,
  createWorkerAttemptRoots,
  resolveWorkerAttemptRoots,
  writeWorkerAttemptManifest,
} from '../src/attempt.ts'
import { readDshWorkerEnvironment, type DshWorkerEnvironment } from '../src/worker.ts'
import { fenceWorkerAttempt, type WorkerAttemptFenceProof } from '../src/lifecycle.ts'

const execFileAsync = promisify(execFile)

function workerEnvironment(
  root: string,
  attempt = 2,
): DshWorkerEnvironment {
  return readDshWorkerEnvironment({
    DSH_SESSION_ID: 's_org_job',
    DSH_SESSION_ROOT: join(root, 'sessions', 's_org_job'),
    DSH_LEASE_OWNER: 'worker-b',
    DSH_LEASE_GENERATION: String(attempt + 4),
    DSH_COMPUTE_TIER: 'cpu',
    DSH_WORKER_ATTEMPT_COUNT: String(attempt),
    DSH_CALLBACK_URL: 'https://control.example.test/webhooks/dsh-worker/lifecycle',
    DSH_CALLBACK_HMAC_SECRET_REF: 'flinter/dsh-callback-hmac',
    DSH_IMAGE_DIGEST: 'sha256:abc123',
  })
}

describe('non-Orca worker attempt runtime', () => {
  it('derives separate per-attempt roots while retaining the durable session root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flinter-dsh-attempt-'))
    try {
      const environment = workerEnvironment(root, 2)
      const paths = resolveWorkerAttemptRoots({
        environment,
        attemptsRoot: join(root, 'attempts'),
        artifactsRoot: join(root, 'artifacts'),
      })

      expect(paths.sessionRoot).toBe(join(root, 'sessions', 's_org_job'))
      expect(paths.attemptRoot).toBe(join(root, 'attempts', 's_org_job', 'attempt-2'))
      expect(paths.artifactRoot).toBe(join(root, 'artifacts', 's_org_job', 'attempt-2'))
      expect(paths.attemptRoot).not.toBe(paths.artifactRoot)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps the durable DSH root stable across replacement attempts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flinter-dsh-attempt-'))
    try {
      const options = (attempt: number) => ({
        environment: workerEnvironment(root, attempt),
        attemptsRoot: join(root, 'attempts'),
        artifactsRoot: join(root, 'artifacts'),
      })
      const first = resolveWorkerAttemptRoots(options(0))
      const replacement = resolveWorkerAttemptRoots(options(1))

      expect(replacement.sessionRoot).toBe(first.sessionRoot)
      expect(replacement.attemptRoot).not.toBe(first.attemptRoot)
      expect(replacement.artifactRoot).not.toBe(first.artifactRoot)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects path traversal and roots that overlap the durable session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flinter-dsh-attempt-'))
    try {
      const environment = workerEnvironment(root)
      expect(() => resolveWorkerAttemptRoots({
        environment: {
          ...environment,
          launch: { ...environment.launch, dshSessionId: '../escape' },
        },
        attemptsRoot: join(root, 'attempts'),
        artifactsRoot: join(root, 'artifacts'),
      })).toThrow(/unsafe dshSessionId/)

      expect(() => resolveWorkerAttemptRoots({
        environment,
        attemptsRoot: environment.launch.dshSessionRoot,
        artifactsRoot: join(root, 'artifacts'),
      })).toThrow(/overlap the durable session root/)

      const paths = resolveWorkerAttemptRoots({
        environment,
        attemptsRoot: join(root, 'attempts'),
        artifactsRoot: join(root, 'artifacts'),
      })
      expect(() => buildWorkerAttemptManifest({
        ...paths,
        attemptRoot: join(root, 'attempts', 'wrong-session', 'attempt-2'),
      }, { environment })).toThrow(/does not match dshSessionId/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('creates owner-only roots and refuses to reuse an attempt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flinter-dsh-attempt-'))
    try {
      const environment = workerEnvironment(root, 1)
      const options = {
        environment,
        attemptsRoot: join(root, 'attempts'),
        artifactsRoot: join(root, 'artifacts'),
      }
      const paths = await createWorkerAttemptRoots(options)
      expect((await stat(paths.attemptRoot)).mode & 0o777).toBe(0o700)
      expect((await stat(paths.artifactRoot)).mode & 0o777).toBe(0o700)
      await expect(createWorkerAttemptRoots(options)).rejects.toThrow(/reuse worker attempt root/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rolls back the attempt root if the artifact root is already used', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flinter-dsh-attempt-'))
    try {
      const environment = workerEnvironment(root, 1)
      const options = {
        environment,
        attemptsRoot: join(root, 'attempts'),
        artifactsRoot: join(root, 'artifacts'),
      }
      const artifactPath = join(root, 'artifacts', 's_org_job', 'attempt-1')
      await mkdir(artifactPath, { recursive: true, mode: 0o700 })

      await expect(createWorkerAttemptRoots(options)).rejects.toThrow(/reuse worker artifact root/)
      await expect(stat(join(root, 'attempts', 's_org_job', 'attempt-1')))
        .rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('writes one exclusive secret-free manifest per attempt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flinter-dsh-attempt-'))
    try {
      const environment = workerEnvironment(root, 1)
      const paths = await createWorkerAttemptRoots({
        environment,
        attemptsRoot: join(root, 'attempts'),
        artifactsRoot: join(root, 'artifacts'),
      })
      const manifestOptions = {
        environment,
        executorTaskId: 'ecs-task-123',
        route: { provider: 'modelflare', model: 'gpt-5.6-sol' },
        startedAt: '2026-08-29T13:00:00.000Z',
      }
      const expectedManifest = buildWorkerAttemptManifest(paths, manifestOptions)
      const manifest = await writeWorkerAttemptManifest(paths, manifestOptions)
      const manifestPath = join(paths.attemptRoot, 'launch-manifest.json')
      const onDisk = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>

      expect(manifest).toEqual(expectedManifest)
      expect(onDisk).toEqual(expectedManifest)
      expect(onDisk).toMatchObject({
        schemaVersion: 1,
        dshSessionId: 's_org_job',
        leaseGeneration: 5,
        workerAttemptCount: 1,
        executorTaskId: 'ecs-task-123',
        provider: 'modelflare',
        model: 'gpt-5.6-sol',
      })
      expect(JSON.stringify(onDisk)).not.toContain('https://control.example.test')
      expect(JSON.stringify(onDisk)).not.toContain('flinter/dsh-callback-hmac')
      expect((await stat(manifestPath)).mode & 0o777).toBe(0o600)
      await expect(writeWorkerAttemptManifest(paths, {
        environment,
        startedAt: '2026-08-29T13:00:00.000Z',
      })).rejects.toThrow(/reuse launch manifest/)
      expect(() => buildWorkerAttemptManifest(paths, {
        environment,
        route: { provider: 'modelflare', model: 'secret=must-not-be-written' },
      })).toThrow(/secret-shaped data/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses cleanup before fencing and unlinks symlinks without following them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flinter-dsh-attempt-'))
    const external = await mkdtemp(join(tmpdir(), 'flinter-dsh-external-'))
    try {
      const environment = workerEnvironment(root, 1)
      const paths = await createWorkerAttemptRoots({
        environment,
        attemptsRoot: join(root, 'attempts'),
        artifactsRoot: join(root, 'artifacts'),
      })
      const externalMarker = join(external, 'must-survive')
      await writeFile(externalMarker, 'keep', { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await symlink(external, join(paths.attemptRoot, 'external-link'))

      const forgedFence = { terminal: true } as unknown as WorkerAttemptFenceProof
      await expect(cleanupWorkerAttempt(environment, paths, forgedFence))
        .rejects.toThrow(/requires a terminal executor fence/)
      const fence = await fenceWorkerAttempt({
        requestStop: async () => undefined,
        waitForTerminal: async () => ({ terminal: true, state: 'STOPPED' }),
      }, environment.launch)
      await cleanupWorkerAttempt(environment, paths, fence)

      await expect(stat(paths.attemptRoot)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(stat(paths.artifactRoot)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readFile(externalMarker, 'utf8')).resolves.toBe('keep')
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(external, { recursive: true, force: true })
    }
  })

  it('delivers adversarial task text as literal argv with no shell and scrubs credentials', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flinter-dsh-attempt-'))
    try {
      const environment = workerEnvironment(root, 1)
      const paths = await createWorkerAttemptRoots({
        environment,
        attemptsRoot: join(root, 'attempts'),
        artifactsRoot: join(root, 'artifacts'),
      })
      const marker = join(root, 'shell-side-effect')
      const capture = join(root, 'captured-task')
      const task = `  inspect '; touch ${marker}; ' $(touch ${marker}) \`touch ${marker}\` $HOME literally  `
      const script = "require('node:fs').writeFileSync(process.env.CAPTURE_FILE, process.argv.at(-1) ?? '')"
      const launch = buildDshAttemptLaunch({
        environment,
        paths,
        file: process.execPath,
        fixedArgs: ['-e', script, '--', ''],
        cwd: root,
        task,
        inheritedEnvironment: {
          PATH: process.env.PATH,
          CAPTURE_FILE: capture,
          MODELFLARE_API_KEY: 'must-not-reach-child',
        },
      })

      expect(launch.shell).toBe(false)
      expect(launch.args.at(-2)).toBe('')
      expect(launch.args.at(-1)).toBe(task)
      expect(launch.env.DSH_SESSION_ID).toBe('s_org_job')
      expect(launch.env.DSH_ATTEMPT_ROOT).toBe(paths.attemptRoot)
      expect(launch.env.MODELFLARE_API_KEY).toBeUndefined()
      await execFileAsync(launch.file, launch.args, {
        cwd: launch.cwd,
        env: launch.env,
        shell: launch.shell,
      })

      expect(await readFile(capture, 'utf8')).toBe(task)
      await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects launch roots that do not match the durable session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flinter-dsh-attempt-'))
    try {
      const environment = workerEnvironment(root, 1)
      const paths = resolveWorkerAttemptRoots({
        environment,
        attemptsRoot: join(root, 'attempts'),
        artifactsRoot: join(root, 'artifacts'),
      })
      expect(() => buildDshAttemptLaunch({
        environment,
        paths: { ...paths, sessionRoot: join(root, 'other-session') },
        file: process.execPath,
        fixedArgs: [],
        cwd: root,
        task: 'task',
      })).toThrow(/session root must equal dshSessionRoot/)

      expect(() => buildDshAttemptLaunch({
        environment,
        paths,
        file: '/bin/sh',
        fixedArgs: ['-c'],
        cwd: root,
        task: 'task',
      })).toThrow(/shell launch is prohibited/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
