/**
 * Contract-only executor boundary for the post-Orca DSH migration.
 *
 * This package owns the invariants that a future Runta/control-plane adapter
 * must preserve. It intentionally performs no process launch, filesystem
 * mutation, queue submission, AWS call, or Orca call.
 */

import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

/** The contract is implemented for local validation, but no runtime is loaded. */
export const CONTRACT_STATUS = 'CONTRACT_ONLY' as const

/** JSON values are the only payloads accepted at the executor wire boundary. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

export interface ExecutorTask {
  readonly schemaVersion: 1
  readonly runId: string
  readonly taskId: string
  readonly retryLineageId: string
  readonly dshSessionId: string
  readonly payload: JsonValue
}

export interface ExecutorAttempt {
  readonly schemaVersion: 1
  readonly runId: string
  readonly taskId: string
  readonly retryLineageId: string
  readonly dshSessionId: string
  readonly dshSessionRoot: string
  readonly attemptId: string
  readonly attemptNumber: number
  readonly leaseOwner: string
  readonly leaseGeneration: number
  readonly workspaceRoot: string
  readonly evidenceRoot: string
}

export interface AttemptPathOptions {
  readonly workspaceBase: string
  readonly evidenceBase: string
  readonly runId: string
  readonly taskId: string
  readonly attemptId: string
}

export interface AttemptPaths {
  readonly workspaceRoot: string
  readonly evidenceRoot: string
}

export interface AttemptManifest extends ExecutorAttempt {
  readonly taskPayloadSha256: string
}

export interface FenceToken {
  readonly dshSessionId: string
  readonly taskId: string
  readonly retryLineageId: string
  readonly attemptId: string
  readonly leaseOwner: string
  readonly leaseGeneration: number
}

export interface CanaryProof {
  readonly heartbeat: boolean
  readonly destinationWrite: boolean
  readonly artifact: boolean
  readonly workerDone: boolean
}

function required(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`executor ${field} is required`)
  }
  return value.trim()
}

function absolutePath(value: string, field: string): string {
  const normalized = required(value, field)
  if (!normalized.startsWith('/')) throw new Error(`executor ${field} must be absolute`)
  return normalized
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`executor ${field} must be a non-negative safe integer`)
  }
  return value
}

function safePathPart(value: string, field: string): string {
  const part = required(value, field)
  if (!/^[A-Za-z0-9._-]+$/.test(part) || part === '.' || part === '..') {
    throw new Error(`executor ${field} contains unsafe path characters`)
  }
  return part
}

function deepFreeze<T extends JsonValue>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      deepFreeze(child as JsonValue)
    }
    Object.freeze(value)
  }
  return value
}

/**
 * Encode the task as one JSON value. A caller can pass this result as one
 * process argument or request body; this function never creates shell source.
 */
export function encodeLiteralTask(task: ExecutorTask): string {
  const normalized = normalizeExecutorTask(task)
  const encoded = JSON.stringify({
    schemaVersion: normalized.schemaVersion,
    runId: normalized.runId,
    taskId: normalized.taskId,
    retryLineageId: normalized.retryLineageId,
    dshSessionId: normalized.dshSessionId,
    payload: normalized.payload,
  })
  if (encoded === undefined) throw new Error('executor task payload must be JSON-serializable')
  return encoded
}

/** Normalize and deep-freeze a task before it crosses the executor seam. */
export function normalizeExecutorTask(task: ExecutorTask): ExecutorTask {
  if (task.schemaVersion !== 1) throw new Error('executor task schemaVersion must be 1')
  const encoded = JSON.stringify(task.payload)
  if (encoded === undefined) throw new Error('executor task payload must be JSON-serializable')
  let payload: JsonValue
  try {
    payload = JSON.parse(encoded) as JsonValue
  } catch (error) {
    throw new Error('executor task payload must be valid JSON', { cause: error })
  }
  return Object.freeze({
    schemaVersion: 1,
    runId: safePathPart(task.runId, 'runId'),
    taskId: safePathPart(task.taskId, 'taskId'),
    retryLineageId: safePathPart(task.retryLineageId, 'retryLineageId'),
    dshSessionId: required(task.dshSessionId, 'dshSessionId'),
    payload: deepFreeze(payload),
  })
}

/** Derive isolated paths without creating them or reusing a prior attempt. */
export function deriveAttemptPaths(options: AttemptPathOptions): AttemptPaths {
  const workspaceBase = absolutePath(options.workspaceBase, 'workspaceBase')
  const evidenceBase = absolutePath(options.evidenceBase, 'evidenceBase')
  const runId = safePathPart(options.runId, 'runId')
  const taskId = safePathPart(options.taskId, 'taskId')
  const attemptId = safePathPart(options.attemptId, 'attemptId')
  return Object.freeze({
    workspaceRoot: resolve(workspaceBase, runId, taskId, attemptId),
    evidenceRoot: resolve(evidenceBase, runId, taskId, attemptId),
  })
}

/**
 * Create the metadata that a future launcher must persist before execution.
 * The task body is represented only by a digest so manifests do not become a
 * secret or prompt logging channel.
 */
export function createAttemptManifest(
  task: ExecutorTask,
  attempt: Omit<ExecutorAttempt, 'schemaVersion' | 'runId' | 'taskId' | 'retryLineageId' | 'dshSessionId'> & {
    readonly runId: string
    readonly taskId: string
    readonly retryLineageId: string
    readonly dshSessionId: string
  },
): AttemptManifest {
  const normalizedTask = normalizeExecutorTask(task)
  const runId = safePathPart(attempt.runId, 'runId')
  const taskId = safePathPart(attempt.taskId, 'taskId')
  const retryLineageId = safePathPart(attempt.retryLineageId, 'retryLineageId')
  const dshSessionId = required(attempt.dshSessionId, 'dshSessionId')
  if (
    normalizedTask.runId !== runId
    || normalizedTask.taskId !== taskId
    || normalizedTask.retryLineageId !== retryLineageId
    || normalizedTask.dshSessionId !== dshSessionId
  ) {
    throw new Error('executor task and attempt identities must agree')
  }
  const manifest: AttemptManifest = {
    schemaVersion: 1,
    runId,
    taskId,
    retryLineageId,
    dshSessionId,
    dshSessionRoot: absolutePath(attempt.dshSessionRoot, 'dshSessionRoot'),
    attemptId: safePathPart(attempt.attemptId, 'attemptId'),
    attemptNumber: nonNegativeInteger(attempt.attemptNumber, 'attemptNumber'),
    leaseOwner: required(attempt.leaseOwner, 'leaseOwner'),
    leaseGeneration: nonNegativeInteger(attempt.leaseGeneration, 'leaseGeneration'),
    workspaceRoot: absolutePath(attempt.workspaceRoot, 'workspaceRoot'),
    evidenceRoot: absolutePath(attempt.evidenceRoot, 'evidenceRoot'),
    taskPayloadSha256: createHash('sha256').update(encodeLiteralTask(normalizedTask)).digest('hex'),
  }
  return Object.freeze(manifest)
}

/** Bind the logical DSH/control-plane identity used by every worker callback. */
export function fenceTokenFor(attempt: ExecutorAttempt): FenceToken {
  return Object.freeze({
    dshSessionId: required(attempt.dshSessionId, 'dshSessionId'),
    taskId: required(attempt.taskId, 'taskId'),
    retryLineageId: required(attempt.retryLineageId, 'retryLineageId'),
    attemptId: required(attempt.attemptId, 'attemptId'),
    leaseOwner: required(attempt.leaseOwner, 'leaseOwner'),
    leaseGeneration: nonNegativeInteger(attempt.leaseGeneration, 'leaseGeneration'),
  })
}

/** Reject stale or cross-task callbacks before they reach a state mutation. */
export function assertCurrentFence(expected: FenceToken, presented: FenceToken): void {
  const fields: readonly (keyof FenceToken)[] = [
    'dshSessionId', 'taskId', 'retryLineageId', 'attemptId', 'leaseOwner', 'leaseGeneration',
  ]
  for (const field of fields) {
    if (expected[field] !== presented[field]) {
      throw new Error(`executor stale fence: ${field} does not match current attempt`)
    }
  }
}

/**
 * Validate a replacement attempt. Lease monotonicity belongs to the
 * control-plane store; this function ensures the DSH adapter cannot accept a
 * replacement that violates the store's already-issued identity.
 */
export function assertFreshReplacement(previous: ExecutorAttempt, replacement: ExecutorAttempt): void {
  if (previous.schemaVersion !== 1 || replacement.schemaVersion !== 1) {
    throw new Error('executor attempt schemaVersion must be 1')
  }
  for (const field of ['runId', 'taskId', 'retryLineageId', 'dshSessionId'] as const) {
    if (previous[field] !== replacement[field]) {
      throw new Error(`executor replacement must preserve ${field}`)
    }
  }
  if (previous.attemptId === replacement.attemptId) throw new Error('executor replacement must use a fresh attemptId')
  if (replacement.attemptNumber <= previous.attemptNumber) throw new Error('executor replacement attemptNumber must increase')
  if (replacement.leaseGeneration <= previous.leaseGeneration) throw new Error('executor replacement leaseGeneration must increase')
  if (previous.workspaceRoot === replacement.workspaceRoot) throw new Error('executor replacement workspaceRoot must be fresh')
  if (previous.evidenceRoot === replacement.evidenceRoot) throw new Error('executor replacement evidenceRoot must be fresh')
}

/** Require all local canary observations before allowing fan-out. */
export function assertCanaryComplete(proof: CanaryProof): CanaryProof {
  const requiredKeys: readonly (keyof CanaryProof)[] = ['heartbeat', 'destinationWrite', 'artifact', 'workerDone']
  if (!requiredKeys.every(key => proof[key] === true)) {
    throw new Error('executor canary proof is incomplete')
  }
  return Object.freeze({ ...proof })
}

/** The future Runta adapter implements this interface; this package does not. */
export interface RuntaExecutorBoundary {
  readonly status: typeof CONTRACT_STATUS
  readonly submit: (task: ExecutorTask) => Promise<ExecutorAttempt>
  readonly cancel: (attemptId: string, fence: FenceToken) => Promise<void>
}
