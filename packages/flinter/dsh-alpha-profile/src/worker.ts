/**
 * Phase 1 worker/session adapter for the pinned DeepSeek Harness alpha.
 *
 * The control plane owns lease and worker identity. DSH owns the live Agent,
 * Session, model routing, and persistence mechanics. This adapter joins those
 * contracts without creating a second worker runtime or accepting a new
 * session identity during resume.
 */

import {
  installModelSelection,
  type AgentSetup,
  type AgentHandle,
  type AgentRegistry,
  type ModelSelection,
} from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionId as SessionIdValue } from '@deepseek-ai/dsh-session'

/** The identity/fencing fields supplied by the control-plane worker launcher. */
export interface DshWorkerLaunchContract {
  readonly dshSessionId: string
  readonly dshSessionRoot: string
  readonly leaseOwner: string
  readonly leaseGeneration: number
  readonly workerAttemptCount: number
}

/** The alpha Agent calls needed by this adapter; concrete runtime stays injectable. */
export type WorkerAgentRegistry = Pick<AgentRegistry, 'create' | 'resume'>

/** Model and process metadata for one worker Agent. */
export interface WorkerAgentOptions {
  readonly cwd: string
  readonly selection: ModelSelection
}

/** A validated identity binding shared by the DSH Agent and persistence root. */
export interface WorkerSessionBinding extends DshWorkerLaunchContract {
  readonly sessionId: SessionIdValue
  /** The root that must be configured on the alpha session-persistence plugin. */
  readonly persistenceRoot: string
}

function nonEmpty(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`worker ${field} is required`)
  }
  return value.trim()
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`worker ${field} must be a non-negative integer`)
  }
  return value
}

/** Validate and normalize a launcher contract without exposing secret material. */
export function validateWorkerLaunchContract(
  launch: DshWorkerLaunchContract,
): DshWorkerLaunchContract {
  const dshSessionId = nonEmpty(launch.dshSessionId, 'dshSessionId')
  const dshSessionRoot = nonEmpty(launch.dshSessionRoot, 'dshSessionRoot')
  const leaseOwner = nonEmpty(launch.leaseOwner, 'leaseOwner')
  if (!dshSessionRoot.startsWith('/')) {
    throw new Error('worker dshSessionRoot must be an absolute path')
  }
  return {
    dshSessionId,
    dshSessionRoot,
    leaseOwner,
    leaseGeneration: nonNegativeInteger(launch.leaseGeneration, 'leaseGeneration'),
    workerAttemptCount: nonNegativeInteger(launch.workerAttemptCount, 'workerAttemptCount'),
  }
}

/**
 * Prove the control-plane resume invariant before touching the DSH registry.
 * A replacement may advance only its lease/attempt identity; it never mints
 * a different session or silently switches its durable root.
 */
export function assertWorkerResumeCompatible(
  previousLaunch: DshWorkerLaunchContract,
  replacementLaunch: DshWorkerLaunchContract,
): DshWorkerLaunchContract {
  const previous = validateWorkerLaunchContract(previousLaunch)
  const replacement = validateWorkerLaunchContract(replacementLaunch)
  if (replacement.dshSessionId !== previous.dshSessionId) {
    throw new Error('worker resume must continue the same dshSessionId')
  }
  if (replacement.dshSessionRoot !== previous.dshSessionRoot) {
    throw new Error('worker resume must continue the same dshSessionRoot')
  }
  if (replacement.leaseGeneration <= previous.leaseGeneration) {
    throw new Error('worker resume leaseGeneration must strictly increase')
  }
  if (replacement.workerAttemptCount <= previous.workerAttemptCount) {
    throw new Error('worker resume workerAttemptCount must strictly increase')
  }
  return replacement
}

/**
 * Bind DSH's branded SessionId to the exact persistence root stamped by the
 * control plane. The alpha registry has no root argument, so the host must
 * configure session persistence with this value before calling start/resume.
 */
export function bindWorkerSession(
  launch: DshWorkerLaunchContract,
  persistenceRoot: string,
): WorkerSessionBinding {
  const normalized = validateWorkerLaunchContract(launch)
  const configuredRoot = nonEmpty(persistenceRoot, 'persistenceRoot')
  if (configuredRoot !== normalized.dshSessionRoot) {
    throw new Error('worker persistenceRoot must equal dshSessionRoot')
  }
  return Object.freeze({
    ...normalized,
    sessionId: SessionId(normalized.dshSessionId),
    persistenceRoot: configuredRoot,
  })
}

function agentInput(options: WorkerAgentOptions): { cwd: string; selection: ModelSelection } {
  const cwd = nonEmpty(options.cwd, 'cwd')
  if (!cwd.startsWith('/')) throw new Error('worker cwd must be an absolute path')
  const provider = nonEmpty(options.selection.provider, 'provider')
  const model = nonEmpty(options.selection.model, 'model')
  return { cwd, selection: { ...options.selection, provider, model } }
}

function setupSelection(selection: ModelSelection): AgentSetup {
  return (agentCtx) => {
    installModelSelection(agentCtx, { current: selection, assembled: undefined })
  }
}

/** Create a new alpha Agent on the control-plane supplied session identity. */
export async function startWorkerAgent(
  agents: WorkerAgentRegistry,
  binding: WorkerSessionBinding,
  options: WorkerAgentOptions,
): Promise<AgentHandle> {
  const validatedBinding = bindWorkerSession(binding, binding.persistenceRoot)
  const { cwd, selection } = agentInput(options)
  return agents.create({
    sessionId: validatedBinding.sessionId,
    meta: { cwd },
    agentOptions: selection,
    setup: setupSelection(selection),
  })
}

/** Resume the same alpha Session after a control-plane lease replacement. */
export async function resumeWorkerAgent(
  agents: WorkerAgentRegistry,
  previousLaunch: DshWorkerLaunchContract,
  replacementLaunch: DshWorkerLaunchContract,
  persistenceRoot: string,
  options: WorkerAgentOptions,
): Promise<AgentHandle> {
  const binding = bindWorkerSession(
    assertWorkerResumeCompatible(previousLaunch, replacementLaunch),
    persistenceRoot,
  )
  const { selection } = agentInput(options)
  return agents.resume({
    resumeSessionId: binding.sessionId,
    agentOptions: selection,
    setup: setupSelection(selection),
  })
}
