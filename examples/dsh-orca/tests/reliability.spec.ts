import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  assertCanaryProof,
  attemptPaths,
  cleanupAttempt,
  createAttemptPaths,
  fenceDispatch,
  writeLaunchManifest,
} from '../reliability.mjs'

describe('local Orca reliability guards', () => {
  it('derives one isolated home per run/task/attempt', () => {
    const paths = attemptPaths({ root: '/tmp/dsh', artifactRoot: '/tmp/dsh-artifacts', runId: 'run_1', taskId: 'task_2', dispatchId: 'ctx_3' })
    expect(paths.home).toBe(resolve('/tmp/dsh', 'run_1', 'task_2', 'ctx_3'))
    expect(paths.artifacts).toBe(resolve('/tmp/dsh-artifacts', 'run_1', 'task_2', 'ctx_3'))
  })

  it('rejects path traversal and home reuse', () => {
    expect(() => attemptPaths({ runId: '../run', taskId: 'task', dispatchId: 'attempt' })).toThrow(/unsafe/)
    const root = mkdtempSync(join(tmpdir(), 'dsh-reliability-'))
    const first = createAttemptPaths({ root, artifactRoot: join(root, 'artifacts'), runId: 'run', taskId: 'task', dispatchId: 'attempt' })
    expect(() => createAttemptPaths({ root, artifactRoot: join(root, 'artifacts'), runId: 'run', taskId: 'task', dispatchId: 'attempt' })).toThrow(/reuse/)
    cleanupAttempt(first, { fenced: true })
  })

  it('writes a secret-free launch manifest outside the artifact directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-reliability-'))
    const paths = createAttemptPaths({ root, artifactRoot: join(root, 'artifacts'), runId: 'run', taskId: 'task', dispatchId: 'attempt' })
    writeLaunchManifest(paths, { runId: 'run', taskId: 'task', dispatchId: 'attempt', model: 'easy', destination: '/repo', secret: 'must-not-write' })
    const manifest = JSON.parse(readFileSync(join(paths.home, 'launch-manifest.json'), 'utf8')) as Record<string, unknown>
    expect(manifest).toMatchObject({ runId: 'run', taskId: 'task', dispatchId: 'attempt', model: 'easy' })
    expect(JSON.stringify(manifest)).not.toContain('must-not-write')
    cleanupAttempt(paths, { fenced: true })
  })

  it('requires a complete canary before fan-out', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-reliability-'))
    const proof = join(root, 'canary.json')
    writeFileSync(proof, JSON.stringify({ heartbeat: true, destinationWrite: true, artifact: true, workerDone: false }))
    expect(() => assertCanaryProof(proof)).toThrow(/incomplete/)
    writeFileSync(proof, JSON.stringify({ heartbeat: true, destinationWrite: true, artifact: true, workerDone: true }))
    expect(assertCanaryProof(proof)).toBe(proof)
  })

  it('fences an uncertain dispatch and verifies the terminal state', () => {
    const calls: string[][] = []
    const responses = [
      { result: { dispatch: { state: 'pending' } } },
      { result: { dispatch: { state: 'stopped' } } },
      { result: { dispatch: { state: 'stopped' } } },
    ]
    const exec = (_file: string, args: string[]) => {
      calls.push(args)
      return JSON.stringify(responses.shift())
    }
    const result = fenceDispatch('ctx_1', { exec })
    expect(result).toMatchObject({ dispatchId: 'ctx_1', state: 'stopped', fenced: true, action: 'worker-stop' })
    expect(calls[1]).toContain('worker-stop')
  })

  it('refuses cleanup unless fencing is confirmed', () => {
    const paths = { home: mkdtempSync(join(tmpdir(), 'dsh-reliability-')) }
    expect(() => {
      cleanupAttempt(paths)
    }).toThrow(/fencing/)
    cleanupAttempt(paths, { fenced: true })
  })
})
