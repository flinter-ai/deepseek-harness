/**
 * Shell-free launch specs, isolated attempt roots, and secret-free manifests.
 * @module @deepseek-ai/dsh-alpha-profile/attempt
 */

import { lstat, mkdir, readdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { SessionId, type SessionId as SessionIdValue } from '@deepseek-ai/dsh-session'
import type { DshWorkerEnvironment } from './worker.ts'
import {
  isWorkerAttemptFenceProof,
  type WorkerAttemptFenceProof,
} from './lifecycle.ts'

const SAFE_ID = /^[A-Za-z0-9._-]+$/
const SENSITIVE_ENV_NAME = /(?:KEY|SECRET|TOKEN|PASSWORD)/i
const SECRET_SHAPED_VALUE = /(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|AUTHORIZATION|BEARER)\s*[:=]/i
const SHELL_EXECUTABLES = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'pwsh', 'powershell'])
const SHELL_CONTROL_ARGUMENTS = new Set(['-c', '-C', '--command', '--execute', '-command', '-encodedcommand', '/c', '/C'])
const MANIFEST_FILE = 'launch-manifest.json'

/** Branded opaque identity for the control-plane lease owner. */
export type WorkerLeaseOwner = Branded<'DshWorkerLeaseOwner'>

/** Brand a validated control-plane lease owner for manifest serialization.
 * @param value - validated lease-owner text.
 * @returns the branded lease-owner identity.
 */
export function WorkerLeaseOwner(value: string): WorkerLeaseOwner {
  return value as WorkerLeaseOwner
}

/** Branded opaque identity for an executor task. */
export type WorkerExecutorTaskId = Branded<'DshWorkerExecutorTaskId'>

/** Brand a validated executor task identity for manifest serialization.
 * @param value - validated executor-task text.
 * @returns the branded executor-task identity.
 */
export function WorkerExecutorTaskId(value: string): WorkerExecutorTaskId {
  return value as WorkerExecutorTaskId
}

/** The durable DSH session root and the disposable roots for one execution attempt. */
export interface WorkerAttemptRoots {
  readonly sessionRoot: string
  readonly attemptRoot: string
  readonly artifactRoot: string
}

/** Roots used to derive one durable session and one ephemeral attempt. */
export interface WorkerAttemptRootOptions {
  readonly environment: DshWorkerEnvironment
  readonly attemptsRoot: string
  readonly artifactsRoot: string
}

/** The launch record written once, before an attempt starts work. */
export interface WorkerAttemptManifest {
  readonly schemaVersion: 1
  readonly dshSessionId: SessionIdValue
  readonly dshSessionRoot: string
  readonly leaseOwner: WorkerLeaseOwner
  readonly leaseGeneration: number
  readonly workerAttemptCount: number
  readonly computeTier: string
  readonly imageDigest: string
  readonly startedAt: string
  readonly attemptRoot: string
  readonly artifactRoot: string
  readonly executorTaskId?: WorkerExecutorTaskId
  readonly provider?: string
  readonly model?: string
}

/** Optional executor and model-route fields for one launch manifest. */
export interface WorkerAttemptManifestOptions {
  readonly environment: DshWorkerEnvironment
  readonly executorTaskId?: string
  readonly route?: Readonly<{
    provider: string
    model: string
  }>
  readonly startedAt?: string
}

/** A direct child-process launch. The task is an argument, never shell source. */
export interface DshAttemptLaunchInput {
  readonly environment: DshWorkerEnvironment
  readonly paths: WorkerAttemptRoots
  readonly file: string
  readonly fixedArgs: readonly string[]
  readonly cwd: string
  readonly task: string
  readonly inheritedEnvironment?: Readonly<Record<string, string | undefined>>
}

/** Complete direct-process specification returned to the executor adapter. */
export interface DshAttemptLaunchSpec {
  readonly file: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  readonly shell: false
}

class AttemptRuntimeError extends Error {
  readonly code: string

  constructor(code: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'AttemptRuntimeError'
    this.code = code
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\u0000')) {
    throw new Error(`worker ${field} is required and must not contain NUL`)
  }
  return value
}

function argvValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.includes('\u0000')) {
    throw new Error(`worker ${field} must be a string without NUL`)
  }
  return value
}

function normalizedText(value: unknown, field: string): string {
  return text(value, field).trim()
}

function manifestText(value: unknown, field: string): string {
  const output = normalizedText(value, field)
  if (SECRET_SHAPED_VALUE.test(output)) {
    throw new Error(`worker manifest ${field} must not contain secret-shaped data`)
  }
  return output
}

function absolutePath(value: unknown, field: string): string {
  const path = normalizedText(value, field)
  if (!isAbsolute(path)) throw new Error(`worker ${field} must be an absolute path`)
  return resolve(path)
}

function safeId(value: unknown, field: string): string {
  const id = normalizedText(value, field)
  if (!SAFE_ID.test(id) || id === '.' || id === '..') {
    throw new Error(`worker unsafe ${field}`)
  }
  return id
}

function safeNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`worker ${field} must be a non-negative integer`)
  }
  return value as number
}

function containsPath(parent: string, child: string): boolean {
  const childRelative = relative(parent, child)
  return childRelative === ''
    || (childRelative !== '..'
      && !childRelative.startsWith(`..${sep}`)
      && !isAbsolute(childRelative))
}

function overlaps(left: string, right: string): boolean {
  return containsPath(left, right) || containsPath(right, left)
}

function validateAttemptRoots(
  environment: DshWorkerEnvironment,
  paths: WorkerAttemptRoots,
): WorkerAttemptRoots {
  const sessionRoot = absolutePath(paths.sessionRoot, 'sessionRoot')
  const attemptRoot = absolutePath(paths.attemptRoot, 'attemptRoot')
  const artifactRoot = absolutePath(paths.artifactRoot, 'artifactRoot')
  const expectedSessionRoot = absolutePath(environment.launch.dshSessionRoot, 'dshSessionRoot')

  if (sessionRoot !== expectedSessionRoot) {
    throw new Error('worker session root must equal dshSessionRoot')
  }
  if (overlaps(sessionRoot, attemptRoot) || overlaps(sessionRoot, artifactRoot)) {
    throw new Error('worker attempt roots must not overlap the durable session root')
  }
  if (overlaps(attemptRoot, artifactRoot)) {
    throw new Error('worker attempt and artifact roots must be separate')
  }
  const expectedAttemptName = `attempt-${environment.launch.workerAttemptCount}`
  const expectedSessionName = environment.launch.dshSessionId
  for (const root of [attemptRoot, artifactRoot]) {
    if (basename(root) !== expectedAttemptName || basename(dirname(root)) !== expectedSessionName) {
      throw new Error('worker attempt root does not match dshSessionId and workerAttemptCount')
    }
  }
  return Object.freeze({ sessionRoot, attemptRoot, artifactRoot })
}

function rootParents(paths: WorkerAttemptRoots): string[] {
  return [resolve(paths.attemptRoot, '..'), resolve(paths.artifactRoot, '..')]
}

/** Derive a stable attempt envelope without changing the durable DSH identity.
 * @param options - worker identity and trusted root bases.
 * @returns normalized durable and ephemeral roots.
 */
export function resolveWorkerAttemptRoots(options: WorkerAttemptRootOptions): WorkerAttemptRoots {
  const sessionRoot = absolutePath(options.environment.launch.dshSessionRoot, 'dshSessionRoot')
  const sessionId = safeId(options.environment.launch.dshSessionId, 'dshSessionId')
  const attempt = safeNonNegativeInteger(
    options.environment.launch.workerAttemptCount,
    'workerAttemptCount',
  )
  const attemptsRoot = absolutePath(options.attemptsRoot, 'attemptsRoot')
  const artifactsRoot = absolutePath(options.artifactsRoot, 'artifactsRoot')
  return validateAttemptRoots(options.environment, {
    sessionRoot,
    attemptRoot: join(attemptsRoot, sessionId, `attempt-${attempt}`),
    artifactRoot: join(artifactsRoot, sessionId, `attempt-${attempt}`),
  })
}

/** Create private roots exactly once; an existing attempt is never reused.
 * @param options - worker identity and trusted root bases.
 * @returns the created durable and ephemeral roots.
 */
export async function createWorkerAttemptRoots(
  options: WorkerAttemptRootOptions,
): Promise<WorkerAttemptRoots> {
  const paths = resolveWorkerAttemptRoots(options)
  await Promise.all(rootParents(paths).map(parent => mkdir(parent, { recursive: true, mode: 0o700 })))
  try {
    await mkdir(paths.attemptRoot, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new AttemptRuntimeError('ATTEMPT_REUSED', 'worker reuse worker attempt root', error)
    }
    throw error
  }
  try {
    await mkdir(paths.artifactRoot, { mode: 0o700 })
  } catch (error) {
    try {
      await removeAttemptTree(paths.attemptRoot)
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'worker attempt root rollback failed after artifact root creation failed',
      )
    }
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new AttemptRuntimeError('ARTIFACT_REUSED', 'worker reuse worker artifact root', error)
    }
    throw error
  }
  return paths
}

function validatedManifestOptions(options: WorkerAttemptManifestOptions): {
  readonly environment: DshWorkerEnvironment
  readonly executorTaskId: WorkerExecutorTaskId | undefined
  readonly provider: string | undefined
  readonly model: string | undefined
  readonly startedAt: string
} {
  const startedAt = options.startedAt ?? new Date().toISOString()
  if (!Number.isFinite(Date.parse(startedAt))) {
    throw new Error('worker manifest startedAt must be a valid timestamp')
  }
  return {
    environment: options.environment,
    executorTaskId: options.executorTaskId === undefined
      ? undefined
      : WorkerExecutorTaskId(manifestText(options.executorTaskId, 'executorTaskId')),
    provider: options.route === undefined ? undefined : manifestText(options.route.provider, 'provider'),
    model: options.route === undefined ? undefined : manifestText(options.route.model, 'model'),
    startedAt,
  }
}

/** Build the secret-free record for one attempt without writing it.
 * @param paths - validated roots for this attempt.
 * @param options - worker identity and optional launch metadata.
 * @returns the in-memory manifest record.
 */
export function buildWorkerAttemptManifest(
  paths: WorkerAttemptRoots,
  options: WorkerAttemptManifestOptions,
): WorkerAttemptManifest {
  const validatedPaths = validateAttemptRoots(options.environment, paths)
  const validated = validatedManifestOptions(options)
  const { launch } = validated.environment
  const manifest: WorkerAttemptManifest = {
    schemaVersion: 1,
    dshSessionId: SessionId(manifestText(launch.dshSessionId, 'dshSessionId')),
    dshSessionRoot: manifestText(launch.dshSessionRoot, 'dshSessionRoot'),
    leaseOwner: WorkerLeaseOwner(manifestText(launch.leaseOwner, 'leaseOwner')),
    leaseGeneration: launch.leaseGeneration,
    workerAttemptCount: launch.workerAttemptCount,
    computeTier: manifestText(validated.environment.computeTier, 'computeTier'),
    imageDigest: manifestText(validated.environment.imageDigest, 'imageDigest'),
    startedAt: validated.startedAt,
    attemptRoot: validatedPaths.attemptRoot,
    artifactRoot: validatedPaths.artifactRoot,
    ...(validated.executorTaskId === undefined ? {} : { executorTaskId: validated.executorTaskId }),
    ...(validated.provider === undefined ? {} : { provider: validated.provider }),
    ...(validated.model === undefined ? {} : { model: validated.model }),
  }
  return Object.freeze(manifest)
}

/** Write the launch record with an exclusive owner-only create.
 * @param paths - validated roots for this attempt.
 * @param options - worker identity and optional launch metadata.
 * @returns the manifest record written to disk.
 */
export async function writeWorkerAttemptManifest(
  paths: WorkerAttemptRoots,
  options: WorkerAttemptManifestOptions,
): Promise<WorkerAttemptManifest> {
  const manifest = buildWorkerAttemptManifest(paths, options)
  try {
    await writeFile(
      join(manifest.attemptRoot, MANIFEST_FILE),
      `${JSON.stringify(manifest)}\n`,
      { encoding: 'utf8', mode: 0o600, flag: 'wx' },
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new AttemptRuntimeError('MANIFEST_REUSED', 'worker reuse launch manifest', error)
    }
    throw error
  }
  return manifest
}

async function removeAttemptTree(path: string): Promise<void> {
  let entry
  try {
    entry = await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (entry.isSymbolicLink()) {
    await unlink(path)
    return
  }
  if (!entry.isDirectory()) {
    throw new Error(`worker attempt cleanup refuses non-directory root: ${path}`)
  }
  for (const name of await readdir(path)) {
    await removeAttemptTree(join(path, name))
  }
  await rmdir(path)
}

/** Remove only ephemeral roots, and only after the executor fence is proven.
 * @param environment - the worker identity used to validate the roots.
 * @param paths - ephemeral roots to remove.
 * @param fence - unforgeable terminal proof from `fenceWorkerAttempt()`.
 * @returns a promise settled after both roots are removed.
 */
export async function cleanupWorkerAttempt(
  environment: DshWorkerEnvironment,
  paths: WorkerAttemptRoots,
  fence: WorkerAttemptFenceProof,
): Promise<void> {
  const validatedPaths = validateAttemptRoots(environment, paths)
  if (!isWorkerAttemptFenceProof(fence)) {
    throw new Error('worker attempt cleanup requires a terminal executor fence')
  }
  await removeAttemptTree(validatedPaths.attemptRoot)
  await removeAttemptTree(validatedPaths.artifactRoot)
}

function scrubEnvironment(
  inheritedEnvironment: Readonly<Record<string, string | undefined>> | undefined,
): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const [name, value] of Object.entries(inheritedEnvironment ?? {})) {
    if (value === undefined) continue
    if (SENSITIVE_ENV_NAME.test(name)) continue
    if (name.includes('\u0000') || value.includes('\u0000')) {
      throw new Error('worker inherited environment must not contain NUL')
    }
    environment[name] = value
  }
  return environment
}

function assertShellFree(file: string, fixedArgs: readonly string[]): void {
  const executable = basename(file).toLowerCase().replace(/\.exe$/, '')
  if (SHELL_EXECUTABLES.has(executable) || /\.(?:ba)?sh|ps1$/.test(executable)) {
    throw new Error('worker shell launch is prohibited; use a direct DSH executable')
  }
  if (fixedArgs.some(argument => SHELL_CONTROL_ARGUMENTS.has(argument.toLowerCase()))) {
    throw new Error('worker shell control arguments are prohibited')
  }
}

/** Build a shell-free launch spec with explicit DSH fields and a literal task argv.
 * @param input - worker identity, attempt roots, executable, and literal task.
 * @returns a direct child-process launch specification.
 */
export function buildDshAttemptLaunch(input: DshAttemptLaunchInput): DshAttemptLaunchSpec {
  const paths = validateAttemptRoots(input.environment, input.paths)
  const file = text(input.file, 'launch file')
  const cwd = absolutePath(input.cwd, 'cwd')
  const task = text(input.task, 'task')
  const fixedArgs = input.fixedArgs.map((argument, index) => argvValue(argument, `fixedArgs[${index}]`))
  assertShellFree(file, fixedArgs)
  const { launch } = input.environment
  const env = scrubEnvironment(input.inheritedEnvironment)
  Object.assign(env, {
    DSH_SESSION_ID: launch.dshSessionId,
    DSH_SESSION_ROOT: paths.sessionRoot,
    DSH_LEASE_OWNER: launch.leaseOwner,
    DSH_LEASE_GENERATION: String(launch.leaseGeneration),
    DSH_COMPUTE_TIER: input.environment.computeTier,
    DSH_WORKER_ATTEMPT_COUNT: String(launch.workerAttemptCount),
    DSH_CALLBACK_URL: input.environment.callbackUrl,
    DSH_CALLBACK_HMAC_SECRET_REF: input.environment.callbackHmacSecretRef,
    DSH_IMAGE_DIGEST: input.environment.imageDigest,
    DSH_ATTEMPT_ROOT: paths.attemptRoot,
    DSH_ARTIFACT_ROOT: paths.artifactRoot,
  })
  return Object.freeze({
    file,
    args: Object.freeze([...fixedArgs, task]),
    cwd,
    env: Object.freeze(env),
    shell: false,
  })
}
