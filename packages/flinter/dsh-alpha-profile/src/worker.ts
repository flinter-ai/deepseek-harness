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

/** The non-secret environment contract stamped by the control-plane launcher. */
export const DSH_WORKER_ENV = Object.freeze({
  sessionId: 'DSH_SESSION_ID',
  sessionRoot: 'DSH_SESSION_ROOT',
  leaseOwner: 'DSH_LEASE_OWNER',
  leaseGeneration: 'DSH_LEASE_GENERATION',
  computeTier: 'DSH_COMPUTE_TIER',
  workerAttemptCount: 'DSH_WORKER_ATTEMPT_COUNT',
  callbackUrl: 'DSH_CALLBACK_URL',
  callbackHmacSecretRef: 'DSH_CALLBACK_HMAC_SECRET_REF',
  imageDigest: 'DSH_IMAGE_DIGEST',
} as const)

/** The identity/fencing fields supplied by the control-plane worker launcher. */
export interface DshWorkerLaunchContract {
  readonly dshSessionId: string
  readonly dshSessionRoot: string
  readonly leaseOwner: string
  readonly leaseGeneration: number
  readonly workerAttemptCount: number
}

/** The complete non-secret worker environment consumed by the alpha driver. */
export interface DshWorkerEnvironment {
  readonly launch: DshWorkerLaunchContract
  readonly computeTier: string
  readonly callbackUrl: string
  /** A reference, never the callback secret itself. */
  readonly callbackHmacSecretRef: string
  readonly imageDigest: string
}

/** The composition row needed to mount the first-party JSONL persistence backend. */
export interface WorkerPersistenceConfig {
  readonly name: '@deepseek-ai/dsh-session-persistence-jsonl'
  readonly config: {
    readonly root: string
    readonly compression: 'zstd'
  }
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

function requiredEnvironmentValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  return nonEmpty(value ?? '', name)
}

function environmentInteger(env: NodeJS.ProcessEnv, name: string): number {
  const value = requiredEnvironmentValue(env, name)
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error(`worker ${name} must be a non-negative integer`)
  }
  return nonNegativeInteger(Number(value), name)
}

/**
 * Parse the launcher environment without reading any credential value. The
 * callback HMAC field is intentionally a reference name, not a secret.
 * @param env - Environment map supplied by the launcher or a test.
 * @returns The validated non-secret worker environment.
 */
export function readDshWorkerEnvironment(env: NodeJS.ProcessEnv = process.env): DshWorkerEnvironment {
  const launch = validateWorkerLaunchContract({
    dshSessionId: requiredEnvironmentValue(env, DSH_WORKER_ENV.sessionId),
    dshSessionRoot: requiredEnvironmentValue(env, DSH_WORKER_ENV.sessionRoot),
    leaseOwner: requiredEnvironmentValue(env, DSH_WORKER_ENV.leaseOwner),
    leaseGeneration: environmentInteger(env, DSH_WORKER_ENV.leaseGeneration),
    workerAttemptCount: environmentInteger(env, DSH_WORKER_ENV.workerAttemptCount),
  })
  const callbackUrl = requiredEnvironmentValue(env, DSH_WORKER_ENV.callbackUrl)
  let parsedCallbackUrl: URL
  try {
    parsedCallbackUrl = new URL(callbackUrl)
  } catch {
    throw new Error(`worker ${DSH_WORKER_ENV.callbackUrl} must be an absolute URL`)
  }
  if (parsedCallbackUrl.protocol !== 'http:' && parsedCallbackUrl.protocol !== 'https:') {
    throw new Error(`worker ${DSH_WORKER_ENV.callbackUrl} must use http or https`)
  }
  return Object.freeze({
    launch,
    computeTier: requiredEnvironmentValue(env, DSH_WORKER_ENV.computeTier),
    callbackUrl,
    callbackHmacSecretRef: requiredEnvironmentValue(env, DSH_WORKER_ENV.callbackHmacSecretRef),
    imageDigest: requiredEnvironmentValue(env, DSH_WORKER_ENV.imageDigest),
  })
}

/**
 * Build the persistence row from the same root used by the control plane.
 * @param persistenceRoot - Absolute durable session root.
 * @returns The alpha JSONL persistence composition row.
 */
export function buildWorkerPersistenceConfig(persistenceRoot: string): WorkerPersistenceConfig {
  const root = nonEmpty(persistenceRoot, 'persistenceRoot')
  if (!root.startsWith('/')) throw new Error('worker persistenceRoot must be an absolute path')
  return Object.freeze({
    name: '@deepseek-ai/dsh-session-persistence-jsonl',
    config: Object.freeze({ root, compression: 'zstd' as const }),
  })
}

/**
 * Validate and normalize a launcher contract without exposing secret material.
 * @param launch - Identity and fencing values stamped by the launcher.
 * @returns A normalized worker launch contract.
 */
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
 * @param previousLaunch - The failed worker's validated launch descriptor.
 * @param replacementLaunch - The replacement worker's launch descriptor.
 * @returns The validated replacement descriptor.
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
 * @param launch - Identity and fencing values stamped by the launcher.
 * @param persistenceRoot - The configured durable session root.
 * @returns The validated binding passed to the DSH agent registry.
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

/**
 * Create a new alpha Agent on the control-plane supplied session identity.
 * @param agents - Injectable alpha agent registry.
 * @param binding - Validated session and persistence identity.
 * @param options - Working directory and model selection for the agent.
 * @returns The newly created agent handle.
 */
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

/**
 * Resume the same alpha Session after a control-plane lease replacement.
 * @param agents - Injectable alpha agent registry.
 * @param previousLaunch - The failed worker's launch descriptor.
 * @param replacementLaunch - The replacement worker's launch descriptor.
 * @param persistenceRoot - The durable session root shared by both attempts.
 * @param options - Working directory and model selection for the agent.
 * @returns The resumed agent handle.
 */
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

/**
 * Launch from the stamped environment. Attempt zero is the only create path;
 * every replacement must supply the previously validated descriptor and uses
 * `resume` exclusively, so a missing persisted session fails closed.
 * @param agents - Injectable alpha agent registry.
 * @param options - Working directory and model selection for the agent.
 * @param env - Environment map supplied by the launcher or a test.
 * @param previousLaunch - Required descriptor when replacing an earlier attempt.
 * @returns The agent handle and the validated launch/persistence configuration.
 */
export async function launchWorkerAgentFromEnvironment(
  agents: WorkerAgentRegistry,
  options: WorkerAgentOptions,
  env: NodeJS.ProcessEnv = process.env,
  previousLaunch?: DshWorkerLaunchContract,
): Promise<{ handle: AgentHandle; environment: DshWorkerEnvironment; persistence: WorkerPersistenceConfig }> {
  const environment = readDshWorkerEnvironment(env)
  const persistence = buildWorkerPersistenceConfig(environment.launch.dshSessionRoot)
  if (environment.launch.workerAttemptCount === 0) {
    if (previousLaunch !== undefined) {
      throw new Error('worker attempt zero cannot resume a previous launch')
    }
    const binding = bindWorkerSession(environment.launch, environment.launch.dshSessionRoot)
    return {
      handle: await startWorkerAgent(agents, binding, options),
      environment,
      persistence,
    }
  }
  if (previousLaunch === undefined) {
    throw new Error('worker resume requires the previous launch descriptor')
  }
  return {
    handle: await resumeWorkerAgent(
      agents,
      previousLaunch,
      environment.launch,
      environment.launch.dshSessionRoot,
      options,
    ),
    environment,
    persistence,
  }
}
