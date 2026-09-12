/**
 * Platform-neutral compute selection and bounded execution contracts.
 *
 * The control plane remains responsible for durable admission and fencing.
 * `DshComputeAdmission` is the local, fail-closed guard used by an adapter;
 * it deliberately does not pretend to be a distributed lock.
 */

import { isAbsolute } from 'node:path'

/** Compute substrates supported by the FLINTER worker contract. */
export const DSH_COMPUTE_BACKENDS = ['codesandbox', 'ec2', 'local'] as const
export type DshComputeBackend = (typeof DSH_COMPUTE_BACKENDS)[number]

/** New workers default to the bounded CodeSandbox substrate. */
export const DEFAULT_DSH_COMPUTE_BACKEND: DshComputeBackend = 'codesandbox'

/** Non-secret environment keys shared by launcher implementations. */
export const DSH_COMPUTE_ENV = Object.freeze({
  backend: 'DSH_COMPUTE_BACKEND',
  maxConcurrent: 'DSH_COMPUTE_MAX_CONCURRENT',
  maxConcurrentPerBackend: 'DSH_COMPUTE_MAX_CONCURRENT_PER_BACKEND',
  maxWallTimeMs: 'DSH_COMPUTE_MAX_WALL_TIME_MS',
  maxIdleTimeMs: 'DSH_COMPUTE_MAX_IDLE_TIME_MS',
  hibernationTimeoutSeconds: 'DSH_COMPUTE_HIBERNATION_TIMEOUT_SECONDS',
} as const)

/** Conservative defaults that prevent accidental fan-out or idle burn. */
export const DEFAULT_DSH_COMPUTE_ADMISSION_POLICY = Object.freeze({
  backend: DEFAULT_DSH_COMPUTE_BACKEND,
  maxConcurrent: 1,
  maxConcurrentPerBackend: 1,
  maxWallTimeMs: 30 * 60 * 1_000,
  maxIdleTimeMs: 5 * 60 * 1_000,
  hibernationTimeoutSeconds: 5 * 60,
} as const)

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\u0000')) {
    throw new Error(`compute ${field} is required and must not contain NUL`)
  }
  return value.trim()
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`compute ${field} must be a positive safe integer`)
  }
  return value as number
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`compute ${field} must be a non-negative safe integer`)
  }
  return value as number
}

/** Parse a backend name without silently accepting an unknown platform. */
export function parseDshComputeBackend(value: unknown = DEFAULT_DSH_COMPUTE_BACKEND): DshComputeBackend {
  if (typeof value !== 'string' || !DSH_COMPUTE_BACKENDS.includes(value as DshComputeBackend)) {
    throw new Error(`compute backend must be one of ${DSH_COMPUTE_BACKENDS.join(', ')}`)
  }
  return value as DshComputeBackend
}

function environmentPositiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name]
  if (raw === undefined) return fallback
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`compute ${name} must be a positive integer`)
  }
  return positiveInteger(Number(raw), name)
}

/** Bounded worker admission values resolved from non-secret environment. */
export interface DshComputeAdmissionPolicy {
  readonly backend: DshComputeBackend
  readonly maxConcurrent: number
  readonly maxConcurrentPerBackend: number
  readonly maxWallTimeMs: number
  readonly maxIdleTimeMs: number
  readonly hibernationTimeoutSeconds: number
}

/** Read the compute policy, defaulting to one CodeSandbox worker at a time. */
export function readDshComputeAdmissionPolicy(
  env: NodeJS.ProcessEnv = process.env,
): DshComputeAdmissionPolicy {
  const policy = {
    backend: parseDshComputeBackend(env[DSH_COMPUTE_ENV.backend]),
    maxConcurrent: environmentPositiveInteger(
      env,
      DSH_COMPUTE_ENV.maxConcurrent,
      DEFAULT_DSH_COMPUTE_ADMISSION_POLICY.maxConcurrent,
    ),
    maxConcurrentPerBackend: environmentPositiveInteger(
      env,
      DSH_COMPUTE_ENV.maxConcurrentPerBackend,
      DEFAULT_DSH_COMPUTE_ADMISSION_POLICY.maxConcurrentPerBackend,
    ),
    maxWallTimeMs: environmentPositiveInteger(
      env,
      DSH_COMPUTE_ENV.maxWallTimeMs,
      DEFAULT_DSH_COMPUTE_ADMISSION_POLICY.maxWallTimeMs,
    ),
    maxIdleTimeMs: environmentPositiveInteger(
      env,
      DSH_COMPUTE_ENV.maxIdleTimeMs,
      DEFAULT_DSH_COMPUTE_ADMISSION_POLICY.maxIdleTimeMs,
    ),
    hibernationTimeoutSeconds: environmentPositiveInteger(
      env,
      DSH_COMPUTE_ENV.hibernationTimeoutSeconds,
      DEFAULT_DSH_COMPUTE_ADMISSION_POLICY.hibernationTimeoutSeconds,
    ),
  }
  if (policy.maxConcurrentPerBackend > policy.maxConcurrent) {
    throw new Error('compute per-backend capacity must not exceed total capacity')
  }
  return Object.freeze(policy)
}

/** Identity used to bind one compute lease to one fenced attempt. */
export interface DshComputeAttemptIdentity {
  readonly sessionId: string
  readonly attemptId: string
  readonly leaseOwner: string
  readonly leaseGeneration: number
  readonly backend?: DshComputeBackend
}

/** Stable failure codes that callers can map to retry/backoff behavior. */
export type DshComputeAdmissionErrorCode =
  | 'COMPUTE_ATTEMPT_ACTIVE'
  | 'COMPUTE_SESSION_ACTIVE'
  | 'COMPUTE_CAPACITY_EXHAUSTED'
  | 'COMPUTE_BACKEND_CAPACITY'
  | 'COMPUTE_LEASE_NOT_CURRENT'

/** A non-secret admission/fencing failure. */
export class DshComputeAdmissionError extends Error {
  readonly code: DshComputeAdmissionErrorCode

  constructor(code: DshComputeAdmissionErrorCode, message: string) {
    super(message)
    this.name = 'DshComputeAdmissionError'
    this.code = code
  }
}

/** A local lease that must be released after terminal fencing. */
export interface DshComputeLease extends DshComputeAttemptIdentity {
  readonly backend: DshComputeBackend
  readonly key: string
  readonly released: boolean
  assertCurrent(): void
  release(): void
}

interface ActiveLease {
  readonly lease: DshComputeLease
  readonly sessionId: string
  readonly backend: DshComputeBackend
}

function validateIdentityForBackend(identity: DshComputeAttemptIdentity, defaultBackend: DshComputeBackend): {
  readonly sessionId: string
  readonly attemptId: string
  readonly leaseOwner: string
  readonly leaseGeneration: number
  readonly backend: DshComputeBackend
} {
  const leaseGeneration = nonNegativeInteger(identity.leaseGeneration, 'leaseGeneration')
  return {
    sessionId: requiredText(identity.sessionId, 'sessionId'),
    attemptId: requiredText(identity.attemptId, 'attemptId'),
    leaseOwner: requiredText(identity.leaseOwner, 'leaseOwner'),
    leaseGeneration,
    backend: parseDshComputeBackend(identity.backend ?? defaultBackend),
  }
}

/**
 * Process-local admission guard. It allows one active attempt per session and
 * enforces total/per-backend capacity. A replacement must release the old
 * lease only after its physical and logical fences are proven.
 */
export class DshComputeAdmission {
  readonly policy: DshComputeAdmissionPolicy
  private readonly activeBySession = new Map<string, ActiveLease>()
  private readonly activeByKey = new Map<string, ActiveLease>()

  constructor(policy: DshComputeAdmissionPolicy = readDshComputeAdmissionPolicy()) {
    this.policy = Object.freeze({ ...policy })
  }

  get activeCount(): number {
    return this.activeBySession.size
  }

  active(backend?: DshComputeBackend): readonly DshComputeLease[] {
    const selected = backend === undefined ? undefined : parseDshComputeBackend(backend)
    return Object.freeze([...this.activeBySession.values()]
      .filter(entry => selected === undefined || entry.backend === selected)
      .map(entry => entry.lease))
  }

  acquire(identity: DshComputeAttemptIdentity): DshComputeLease {
    const normalized = validateIdentityForBackend(identity, this.policy.backend)
    const key = `${normalized.sessionId}\u0000${normalized.attemptId}`
    if (this.activeByKey.has(key)) {
      throw new DshComputeAdmissionError(
        'COMPUTE_ATTEMPT_ACTIVE',
        `compute attempt is already active: ${normalized.sessionId}/${normalized.attemptId}`,
      )
    }
    if (this.activeBySession.has(normalized.sessionId)) {
      throw new DshComputeAdmissionError(
        'COMPUTE_SESSION_ACTIVE',
        `compute session already has an active attempt: ${normalized.sessionId}`,
      )
    }
    if (this.activeCount >= this.policy.maxConcurrent) {
      throw new DshComputeAdmissionError(
        'COMPUTE_CAPACITY_EXHAUSTED',
        `compute capacity exhausted: ${this.policy.maxConcurrent}`,
      )
    }
    const backendCount = this.active(normalized.backend).length
    if (backendCount >= this.policy.maxConcurrentPerBackend) {
      throw new DshComputeAdmissionError(
        'COMPUTE_BACKEND_CAPACITY',
        `compute backend capacity exhausted: ${normalized.backend}`,
      )
    }

    let released = false
    const lease = {
      ...normalized,
      backend: normalized.backend,
      key,
      get released() { return released },
      assertCurrent: () => {
        if (released || this.activeByKey.get(key)?.lease !== lease) {
          throw new DshComputeAdmissionError(
            'COMPUTE_LEASE_NOT_CURRENT',
            `compute lease is no longer current: ${normalized.sessionId}/${normalized.attemptId}`,
          )
        }
      },
      release: () => {
        if (released) return
        released = true
        this.activeByKey.delete(key)
        if (this.activeBySession.get(normalized.sessionId)?.lease === lease) {
          this.activeBySession.delete(normalized.sessionId)
        }
      },
    } satisfies DshComputeLease
    const active: ActiveLease = { lease, sessionId: normalized.sessionId, backend: normalized.backend }
    this.activeByKey.set(key, active)
    this.activeBySession.set(normalized.sessionId, active)
    return Object.freeze(lease)
  }
}

/** Direct argv/environment launch spec passed to a selected backend. */
export interface DshComputeExecutionSpec {
  readonly sessionId: string
  readonly attemptId: string
  readonly argv: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  readonly signal?: AbortSignal
}

/** Minimal running process handle shared by EC2, local, and CodeSandbox. */
export interface DshComputeProcess {
  waitUntilComplete(): Promise<unknown>
  stop(): Promise<void>
}

/** One platform implementation; it does not own admission or persistence. */
export interface DshComputeBackendAdapter {
  readonly backend: DshComputeBackend
  start(spec: DshComputeExecutionSpec): Promise<DshComputeProcess>
}

/** Select a registered platform without changing the DSH worker/runner loop. */
export class DshComputeBackendSelector {
  private readonly adapters: ReadonlyMap<DshComputeBackend, DshComputeBackendAdapter>

  constructor(adapters: readonly DshComputeBackendAdapter[]) {
    const entries = new Map<DshComputeBackend, DshComputeBackendAdapter>()
    for (const adapter of adapters) {
      if (entries.has(adapter.backend)) {
        throw new Error(`compute backend is registered more than once: ${adapter.backend}`)
      }
      entries.set(adapter.backend, adapter)
    }
    this.adapters = entries
  }

  get(backend: DshComputeBackend): DshComputeBackendAdapter {
    const selected = parseDshComputeBackend(backend)
    const adapter = this.adapters.get(selected)
    if (adapter === undefined) throw new Error(`compute backend is not configured: ${selected}`)
    return adapter
  }

  start(spec: DshComputeExecutionSpec, backend: DshComputeBackend): Promise<DshComputeProcess> {
    return this.get(backend).start(spec)
  }
}

/** CodeSandbox VM launch settings kept independent of the optional SDK. */
export interface CodeSandboxCreateOptions {
  readonly templateId?: string
  readonly vmTier: string
  readonly hibernationTimeoutSeconds: number
  readonly automaticWakeupConfig: Readonly<{
    readonly http: boolean
    readonly websocket: boolean
  }>
}

/** Narrow SDK-shaped runtime injected by the host, keeping this package lean. */
export interface CodeSandboxRuntime {
  createSandbox(options: CodeSandboxCreateOptions): Promise<CodeSandboxSandbox>
  disposeSandbox(sandbox: CodeSandboxSandbox): Promise<void>
}

export interface CodeSandboxSandbox {
  readonly id: string
  connect(options: Readonly<{
    readonly env: Readonly<Record<string, string>>
  }>): Promise<CodeSandboxClient>
}

export interface CodeSandboxClient {
  readonly commands: Readonly<{
    runBackground(
      argv: readonly string[],
      options: Readonly<{
        readonly cwd: string
        readonly env: Readonly<Record<string, string>>
        readonly signal?: AbortSignal
      }>,
    ): Promise<CodeSandboxCommand>
  }>
}

export interface CodeSandboxCommand {
  waitUntilComplete(): Promise<unknown>
  kill(): Promise<void>
}

export interface CodeSandboxComputeBackendOptions {
  readonly runtime: CodeSandboxRuntime
  readonly templateId?: string
  readonly vmTier?: string
  readonly hibernationTimeoutSeconds?: number
}

const SAFE_REFERENCE_ENV = 'DSH_CALLBACK_HMAC_SECRET_REF'
const SENSITIVE_ENV_NAME = /(?:KEY|SECRET|TOKEN|PASSWORD)/i

function sandboxEnvironment(env: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const output: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) {
    if (name.includes('\u0000') || value.includes('\u0000')) {
      throw new Error('compute sandbox environment must not contain NUL')
    }
    if (SENSITIVE_ENV_NAME.test(name) && name !== SAFE_REFERENCE_ENV) {
      throw new Error(`compute sandbox refuses credential-shaped environment: ${name}`)
    }
    output[name] = value
  }
  return Object.freeze(output)
}

function sandboxSpec(spec: DshComputeExecutionSpec): DshComputeExecutionSpec {
  const sessionId = requiredText(spec.sessionId, 'sessionId')
  const attemptId = requiredText(spec.attemptId, 'attemptId')
  if (!isAbsolute(spec.cwd)) throw new Error('compute sandbox cwd must be absolute')
  if (spec.argv.length === 0 || spec.argv.some(argument => typeof argument !== 'string' || argument.includes('\u0000'))) {
    throw new Error('compute sandbox argv must be non-empty strings without NUL')
  }
  return Object.freeze({
    sessionId,
    attemptId,
    argv: Object.freeze([...spec.argv]),
    cwd: spec.cwd,
    env: sandboxEnvironment(spec.env),
    ...(spec.signal === undefined ? {} : { signal: spec.signal }),
  })
}

/**
 * CodeSandbox adapter. The host supplies the official SDK through
 * `CodeSandboxRuntime`; this keeps credentials and SDK lifecycle outside the
 * DSH profile package while preserving one direct argv launch and bounded VM
 * cleanup.
 */
export class CodeSandboxComputeBackend implements DshComputeBackendAdapter {
  readonly backend = 'codesandbox' as const
  private readonly options: Required<Pick<CodeSandboxComputeBackendOptions, 'runtime'>>
    & Omit<CodeSandboxComputeBackendOptions, 'runtime'>

  constructor(options: CodeSandboxComputeBackendOptions) {
    const hibernationTimeoutSeconds = options.hibernationTimeoutSeconds
      ?? DEFAULT_DSH_COMPUTE_ADMISSION_POLICY.hibernationTimeoutSeconds
    positiveInteger(hibernationTimeoutSeconds, 'hibernationTimeoutSeconds')
    this.options = {
      ...options,
      runtime: options.runtime,
      vmTier: options.vmTier ?? 'micro',
      hibernationTimeoutSeconds,
    }
  }

  async start(input: DshComputeExecutionSpec): Promise<DshComputeProcess> {
    const spec = sandboxSpec(input)
    const sandbox = await this.options.runtime.createSandbox({
      ...(this.options.templateId === undefined ? {} : { templateId: this.options.templateId }),
      vmTier: this.options.vmTier ?? 'micro',
      hibernationTimeoutSeconds: this.options.hibernationTimeoutSeconds ?? 300,
      automaticWakeupConfig: { http: true, websocket: false },
    })
    let stopped = false
    const dispose = async (): Promise<void> => {
      if (stopped) return
      stopped = true
      await this.options.runtime.disposeSandbox(sandbox)
    }
    try {
      const client = await sandbox.connect({ env: spec.env })
      const command = await client.commands.runBackground(spec.argv, {
        cwd: spec.cwd,
        env: spec.env,
        ...(spec.signal === undefined ? {} : { signal: spec.signal }),
      })
      return {
        waitUntilComplete: async () => {
          try {
            return await command.waitUntilComplete()
          } finally {
            await dispose()
          }
        },
        stop: async () => {
          if (stopped) return
          try {
            await command.kill()
          } finally {
            await dispose()
          }
        },
      }
    } catch (error) {
      await dispose()
      throw error
    }
  }
}
