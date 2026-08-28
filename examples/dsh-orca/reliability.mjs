import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const DEFAULT_DSH_ROOT = '/tmp/dsh'
export const DEFAULT_ARTIFACT_ROOT = '/tmp/dsh-artifacts'

function safePart(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required`)
  }
  const part = value.replace(/[^A-Za-z0-9._-]/g, '_')
  if (part !== value || part === '.' || part === '..') {
    throw new Error(`${name} contains unsafe path characters`)
  }
  return part
}

export function attemptPaths({ root = DEFAULT_DSH_ROOT, artifactRoot = DEFAULT_ARTIFACT_ROOT, runId, taskId, dispatchId }) {
  const run = safePart(runId, 'runId')
  const task = safePart(taskId, 'taskId')
  const attempt = safePart(dispatchId, 'dispatchId')
  return {
    home: resolve(root, run, task, attempt),
    artifacts: resolve(artifactRoot, run, task, attempt),
  }
}

/** Create a never-reused attempt home and a separate evidence directory. */
export function createAttemptPaths(options) {
  const paths = attemptPaths(options)
  mkdirSync(dirname(paths.home), { recursive: true, mode: 0o700 })
  mkdirSync(dirname(paths.artifacts), { recursive: true, mode: 0o700 })
  try {
    mkdirSync(paths.home, { mode: 0o700 })
  } catch (error) {
    if (error.code === 'EEXIST') {
      const reused = new Error(`refusing to reuse DSH attempt home: ${paths.home}`)
      reused.code = 'DSH_HOME_REUSED'
      throw reused
    }
    throw error
  }
  mkdirSync(paths.artifacts, { mode: 0o700 })
  return paths
}

export function writeLaunchManifest(paths, metadata) {
  const manifest = {
    schemaVersion: 1,
    runId: metadata.runId,
    taskId: metadata.taskId,
    dispatchId: metadata.dispatchId,
    model: metadata.model,
    destination: metadata.destination,
    startedAt: new Date().toISOString(),
    artifactsPath: paths.artifacts,
  }
  writeFileSync(join(paths.home, 'launch-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  return manifest
}

export function assertCanaryProof(path) {
  const proof = resolve(path)
  if (!existsSync(proof)) {
    const error = new Error(`canary proof is required before fan-out: ${proof}`)
    error.code = 'CANARY_REQUIRED'
    throw error
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(proof, 'utf8'))
  } catch (error) {
    const invalid = new Error(`canary proof is not valid JSON: ${proof}`)
    invalid.code = 'CANARY_INVALID'
    invalid.cause = error
    throw invalid
  }
  const required = ['heartbeat', 'destinationWrite', 'artifact', 'workerDone']
  if (!required.every((key) => parsed[key] === true)) {
    const incomplete = new Error(`canary proof is incomplete: ${proof}`)
    incomplete.code = 'CANARY_INCOMPLETE'
    throw incomplete
  }
  return proof
}

export function cleanupAttempt(paths, options = {}) {
  if (options.fenced !== true) {
    const error = new Error('refusing to clean an attempt before Orca fencing is confirmed')
    error.code = 'CLEANUP_NOT_FENCED'
    throw error
  }
  rmSync(paths.home, { recursive: true, force: false })
}

function orcaJson(args, exec = execFileSync) {
  return JSON.parse(exec('orca', [...args, '--json'], { encoding: 'utf8' }))
}

/** Fence an uncertain local Orca worker before allowing a retry. */
export function fenceDispatch(dispatchId, options = {}) {
  const exec = options.exec ?? execFileSync
  const shown = orcaJson(['orchestration', 'worker-show', '--dispatch', dispatchId], exec)
  const state = shown.result?.dispatch?.state ?? shown.result?.worker?.state
  if (['completed', 'failed', 'blocked', 'stopped', 'abandoned'].includes(state)) {
    return { dispatchId, state, fenced: true, action: 'already-settled' }
  }
  const command = options.abandon ? 'worker-abandon' : 'worker-stop'
  const args = ['orchestration', command, '--dispatch', dispatchId]
  if (options.retryRequest) args.push('--retry-request', options.retryRequest)
  const result = orcaJson(args, exec)
  const verification = orcaJson(['orchestration', 'worker-show', '--dispatch', dispatchId], exec)
  const finalState = verification.result?.dispatch?.state ?? verification.result?.worker?.state
  if (!['stopped', 'abandoned', 'completed', 'failed', 'blocked'].includes(finalState)) {
    const error = new Error(`worker fence was not confirmed for ${dispatchId} (state=${finalState ?? 'unknown'})`)
    error.code = 'FENCE_UNCONFIRMED'
    throw error
  }
  return { dispatchId, state: finalState, fenced: true, action: command, result }
}
