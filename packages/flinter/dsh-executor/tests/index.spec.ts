import { describe, expect, it } from 'vitest'
import {
  assertCanaryComplete,
  assertCurrentFence,
  assertFreshReplacement,
  CONTRACT_STATUS,
  createAttemptManifest,
  deriveAttemptPaths,
  encodeLiteralTask,
  fenceTokenFor,
  normalizeExecutorTask,
  type ExecutorAttempt,
  type ExecutorTask,
} from '../src/index.ts'

const task: ExecutorTask = {
  schemaVersion: 1,
  runId: 'run_1',
  taskId: 'task_1',
  retryLineageId: 'retry_1',
  dshSessionId: 'dsh_1',
  payload: {
    prompt: 'literal `$(touch /tmp/pwn)` $USER ; do not evaluate',
    args: ['one', { nested: true }],
  },
}

const first: ExecutorAttempt = {
  schemaVersion: 1,
  runId: 'run_1',
  taskId: 'task_1',
  retryLineageId: 'retry_1',
  dshSessionId: 'dsh_1',
  dshSessionRoot: '/sessions/org/dsh_1',
  attemptId: 'attempt_1',
  attemptNumber: 0,
  leaseOwner: 'worker_a',
  leaseGeneration: 4,
  workspaceRoot: '/work/run_1/task_1/attempt_1',
  evidenceRoot: '/evidence/run_1/task_1/attempt_1',
}

describe('@flinter/dsh-executor contract', () => {
  it('is contract-only and preserves malicious task text literally', () => {
    expect(CONTRACT_STATUS).toBe('CONTRACT_ONLY')
    const encoded = encodeLiteralTask(task)
    expect(JSON.parse(encoded)).toMatchObject({ payload: task.payload })
    expect(encoded).toContain('$(touch /tmp/pwn)')
  })

  it('rejects non-JSON task values and path traversal', () => {
    expect(() => normalizeExecutorTask({ ...task, payload: undefined as never })).toThrow(/JSON-serializable/)
    expect(() => deriveAttemptPaths({
      workspaceBase: '/work', evidenceBase: '/evidence', runId: '../run', taskId: 'task', attemptId: 'a',
    })).toThrow(/unsafe path/)
  })

  it('derives separate per-attempt workspace and evidence roots', () => {
    expect(deriveAttemptPaths({
      workspaceBase: '/work', evidenceBase: '/evidence', runId: 'run_1', taskId: 'task_1', attemptId: 'attempt_1',
    })).toEqual({
      workspaceRoot: '/work/run_1/task_1/attempt_1',
      evidenceRoot: '/evidence/run_1/task_1/attempt_1',
    })
  })

  it('creates an immutable manifest bound to the literal payload digest', () => {
    const manifest = createAttemptManifest(task, first)
    expect(manifest).toMatchObject({
      ...first,
      schemaVersion: 1,
      taskPayloadSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(Object.isFrozen(manifest)).toBe(true)
    expect(JSON.stringify(manifest)).not.toContain('touch /tmp/pwn')
  })

  it('rejects stale, cross-task, and cross-attempt fences', () => {
    const current = fenceTokenFor(first)
    expect(() => assertCurrentFence(current, { ...current, leaseGeneration: 3 })).toThrow(/stale fence/)
    expect(() => assertCurrentFence(current, { ...current, taskId: 'other' })).toThrow(/stale fence/)
    expect(() => assertFreshReplacement(first, {
      ...first, attemptId: 'attempt_2', attemptNumber: 1, leaseGeneration: 5,
      workspaceRoot: '/work/run_1/task_1/attempt_2', evidenceRoot: '/evidence/run_1/task_1/attempt_2',
    })).not.toThrow()
    expect(() => assertFreshReplacement(first, first)).toThrow(/fresh attemptId/)
  })

  it('requires the full canary before fan-out', () => {
    expect(() => assertCanaryComplete({ heartbeat: true, destinationWrite: true, artifact: true, workerDone: false })).toThrow(/incomplete/)
    expect(assertCanaryComplete({ heartbeat: true, destinationWrite: true, artifact: true, workerDone: true })).toEqual({
      heartbeat: true, destinationWrite: true, artifact: true, workerDone: true,
    })
  })
})
