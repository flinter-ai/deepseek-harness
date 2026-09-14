/**
 * Logical lease fencing, executor termination proof, and canary admission.
 * @module @deepseek-ai/dsh-alpha-profile/lifecycle
 */

import {
  type DshWorkerLaunchContract,
  validateWorkerLaunchContract,
} from './worker.ts'

/** The terminal state returned by the executor after physical termination. */
export interface WorkerExecutorTerminalState {
  readonly terminal: boolean
  readonly state: string
  readonly observedAt?: string
}

const WORKER_FENCE_PROOF = Symbol('WorkerAttemptFenceProof')

/** A terminal executor observation minted only by `fenceWorkerAttempt()`. */
export interface WorkerAttemptFenceProof extends WorkerExecutorTerminalState {
  readonly terminal: true
  readonly [WORKER_FENCE_PROOF]: true
}

/** The executor operations required before a replacement attempt may start. */
export interface WorkerAttemptFenceExecutor {
  readonly requestStop: (attempt: DshWorkerLaunchContract) => Promise<void>
  readonly waitForTerminal: (attempt: DshWorkerLaunchContract) => Promise<WorkerExecutorTerminalState>
}

/** A canary proof emitted by one real worker before fan-out is enabled. */
export interface WorkerCanaryProof {
  readonly startupReady: boolean
  readonly taskReceivedLiterally: boolean
  readonly sessionPersisted: boolean
  readonly callbackAccepted: boolean
  readonly completionRecorded: boolean
  readonly artifactProduced?: boolean
}

/** Whether the canary must also prove that the attempt produced an artifact. */
export interface WorkerCanaryOptions {
  readonly requireArtifact?: boolean
}

/** Identify a fence proof without accepting a caller-forged `{ terminal: true }`.
 * @param value - unknown callback or cleanup input.
 * @returns whether the value was minted by `fenceWorkerAttempt()`.
 */
export function isWorkerAttemptFenceProof(value: unknown): value is WorkerAttemptFenceProof {
  return typeof value === 'object'
    && value !== null
    && (value as Partial<WorkerAttemptFenceProof>)[WORKER_FENCE_PROOF] === true
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\u0000')) {
    throw new Error(`worker ${field} is required and must not contain NUL`)
  }
  return value.trim()
}

function assertTrue(value: unknown, field: keyof WorkerCanaryProof): void {
  if (value !== true) throw new Error(`worker canary requires ${field}=true`)
}

function assertSameLaunchIdentity(
  currentLaunch: DshWorkerLaunchContract,
  callbackLaunch: DshWorkerLaunchContract,
): void {
  const current = validateWorkerLaunchContract(currentLaunch)
  const callback = validateWorkerLaunchContract(callbackLaunch)
  if (callback.dshSessionId !== current.dshSessionId) {
    throw new Error('worker callback rejected: stale dshSessionId')
  }
  if (callback.dshSessionRoot !== current.dshSessionRoot) {
    throw new Error('worker callback rejected: stale dshSessionRoot')
  }
  if (callback.leaseOwner !== current.leaseOwner) {
    throw new Error('worker callback rejected: stale leaseOwner')
  }
  if (callback.leaseGeneration !== current.leaseGeneration) {
    throw new Error('worker callback rejected: stale leaseGeneration')
  }
  if (callback.workerAttemptCount !== current.workerAttemptCount) {
    throw new Error('worker callback rejected: stale workerAttemptCount')
  }
}

/** Reject a callback that is not from the currently authoritative attempt.
 * @param currentLaunch - current control-plane worker identity.
 * @param callbackLaunch - identity carried by the callback.
 * @returns the validated current callback identity.
 */
export function assertCurrentWorkerCallback(
  currentLaunch: DshWorkerLaunchContract,
  callbackLaunch: DshWorkerLaunchContract,
): DshWorkerLaunchContract {
  assertSameLaunchIdentity(currentLaunch, callbackLaunch)
  return validateWorkerLaunchContract(callbackLaunch)
}

/** Return the callback identity only if its lease and attempt are current.
 * @param currentLaunch - current control-plane worker identity.
 * @param callbackLaunch - identity carried by the callback.
 * @returns the accepted identity, or `undefined` for a stale callback.
 */
export function acceptCurrentWorkerCallback(
  currentLaunch: DshWorkerLaunchContract,
  callbackLaunch: DshWorkerLaunchContract,
): DshWorkerLaunchContract | undefined {
  try {
    return assertCurrentWorkerCallback(currentLaunch, callbackLaunch)
  } catch {
    return undefined
  }
}

/** Physically fence an attempt; completion is not reported until the executor says terminal.
 * @param executor - injected stop and terminal-state operations.
 * @param attempt - worker identity to stop and observe.
 * @returns an unforgeable terminal executor proof.
 */
export async function fenceWorkerAttempt(
  executor: WorkerAttemptFenceExecutor,
  attempt: DshWorkerLaunchContract,
): Promise<WorkerAttemptFenceProof> {
  const validatedAttempt = validateWorkerLaunchContract(attempt)
  await executor.requestStop(validatedAttempt)
  const terminal = await executor.waitForTerminal(validatedAttempt)
  if (!terminal.terminal) {
    throw new Error('worker physical fence requires a terminal executor state')
  }
  requiredText(terminal.state, 'executor terminal state')
  if (terminal.observedAt !== undefined) requiredText(terminal.observedAt, 'executor observedAt')
  return Object.freeze({
    ...terminal,
    terminal: true as const,
    [WORKER_FENCE_PROOF]: true as const,
  })
}

/** Assert the complete canary before allowing a worker fan-out decision.
 * @param proof - observations collected from one worker attempt.
 * @param options - optional artifact requirement.
 * @returns the frozen proof accepted for fan-out.
 */
export function assertWorkerCanaryProof(
  proof: WorkerCanaryProof,
  options: WorkerCanaryOptions = {},
): WorkerCanaryProof {
  assertTrue(proof.startupReady, 'startupReady')
  assertTrue(proof.taskReceivedLiterally, 'taskReceivedLiterally')
  assertTrue(proof.sessionPersisted, 'sessionPersisted')
  assertTrue(proof.callbackAccepted, 'callbackAccepted')
  assertTrue(proof.completionRecorded, 'completionRecorded')
  if (options.requireArtifact === true) assertTrue(proof.artifactProduced, 'artifactProduced')
  if (proof.artifactProduced !== undefined && typeof proof.artifactProduced !== 'boolean') {
    throw new Error('worker canary artifactProduced must be boolean')
  }
  return Object.freeze({ ...proof })
}

/** A canary is the only condition that authorizes fan-out.
 * @param proof - observations collected from one worker attempt.
 * @param options - optional artifact requirement.
 * @returns whether all required observations are present.
 */
export function canaryAllowsFanOut(
  proof: WorkerCanaryProof,
  options: WorkerCanaryOptions = {},
): boolean {
  try {
    assertWorkerCanaryProof(proof, options)
    return true
  } catch {
    return false
  }
}
