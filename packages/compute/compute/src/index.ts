/**
 * The compute capability seam (`ctx.compute`). The service describes the
 * lifecycle shared by local, EC2, Sandpack, and future execution backends;
 * each host supplies the backend implementation and keeps storage,
 * authentication, and process authority outside this contract.
 * @module @deepseek-ai/dsh-compute
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'

/** A backend name; the two shipped integration targets have stable names. */
export type ComputeBackend = 'ec2' | 'sandpack' | (string & {})

/** Operations a compute backend may implement. */
export type ComputeOperation = 'command' | 'preview'

/** Storage authority used by a compute backend. */
export type ComputeStorage = 'host' | 'aws' | 'sandbox'

/** Network authority exposed to a compute operation. */
export type ComputeNetwork = 'none' | 'restricted' | 'full'

/** Bounded capabilities advertised by one mounted backend. */
export interface ComputeCapabilities {
  /** Operations the backend accepts. */
  readonly operations: readonly ComputeOperation[]
  /** Whether the workspace survives a released lease. */
  readonly persistentWorkspace: boolean
  /** Where the backend's workspace data is authoritative. */
  readonly storage: ComputeStorage
  /** Network access available to the backend. */
  readonly network: ComputeNetwork
  /** Maximum concurrent runs admitted by this provider. */
  readonly maxConcurrentRuns: number
}

/** A host-owned workspace identity; the seam never assumes where it is stored. */
export interface ComputeWorkspaceRef {
  /** Stable host workspace identifier. */
  readonly id: string
  /** Optional host revision used to reject stale execution requests. */
  readonly revision?: string
}

/** A request to acquire capacity for one workspace and operation. */
export interface ComputeAcquireRequest {
  readonly workspace: ComputeWorkspaceRef
  readonly operation: ComputeOperation
  /** Credential references only; raw values never cross this seam. */
  readonly credentialRefs?: readonly CredentialRef[]
  /** Upper bound for the lease lifetime in milliseconds. */
  readonly maxDurationMs?: number
}

/** A lease that fences later runs to one backend and workspace. */
export interface ComputeLease {
  readonly id: string
  readonly backend: ComputeBackend
  readonly workspace: ComputeWorkspaceRef
  readonly operation: ComputeOperation
  readonly acquiredAt: number
  readonly expiresAt: number
  readonly capabilities: ComputeCapabilities
}

/** A command operation for EC2 or another process-capable backend. */
export interface ComputeCommandRequest {
  readonly kind: 'command'
  /** Exact argv; shell strings are intentionally not part of this contract. */
  readonly argv: readonly string[]
  /** Absolute or backend-relative working directory selected by the host. */
  readonly cwd?: string
  /** Execution timeout selected by the host. */
  readonly timeoutMs?: number
  /** Bounded output limit; providers must not return unbounded logs. */
  readonly maxOutputBytes?: number
}

/** A preview operation for a browser-backed Sandpack integration. */
export interface ComputePreviewRequest {
  readonly kind: 'preview'
  /** Source files are host-provided and must not contain credential values. */
  readonly files: Readonly<Record<string, string>>
  /** Entry file or module passed to the preview runtime. */
  readonly entry: string
}

/** One operation submitted against a previously acquired lease. */
export type ComputeRequest = ComputeCommandRequest | ComputePreviewRequest

/** Opaque run handle returned before a run reaches a terminal state. */
export interface ComputeRunHandle {
  readonly id: string
  readonly leaseId: string
  readonly backend: ComputeBackend
}

/** Terminal or in-flight run state. */
export type ComputeRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** Host-owned reference to an output artifact; contents stay outside this seam. */
export interface ComputeArtifactRef {
  readonly id: string
  readonly kind: 'preview' | 'log' | 'file' | 'other'
  readonly uri: string
}

/** Bounded textual output returned by a provider. */
export interface ComputeOutput {
  readonly stdout: string
  readonly stderr: string
  readonly truncated: boolean
  readonly maxBytes: number
}

/** Snapshot returned by status polling. */
export interface ComputeRunSnapshot {
  readonly run: ComputeRunHandle
  readonly status: ComputeRunStatus
  readonly startedAt?: number
  readonly finishedAt?: number
  readonly exitCode?: number
  readonly output?: ComputeOutput
  readonly artifacts?: readonly ComputeArtifactRef[]
  /** Provider error code, never a raw secret or credential payload. */
  readonly errorCode?: string
}

export const COMPUTE_UNAVAILABLE = 'COMPUTE_UNAVAILABLE' as const
export const COMPUTE_UNSUPPORTED = 'COMPUTE_UNSUPPORTED' as const

/** A fail-closed error for a backend that is not mounted or cannot start. */
export class ComputeUnavailableError extends Error {
  readonly code = COMPUTE_UNAVAILABLE

  constructor(backend: ComputeBackend, detail?: string) {
    super(`compute backend "${backend}" is unavailable` + (detail === undefined ? '' : `: ${detail}`))
    this.name = 'ComputeUnavailableError'
  }
}

/** A request made to a backend that did not advertise its operation. */
export class ComputeUnsupportedError extends Error {
  readonly code = COMPUTE_UNSUPPORTED

  constructor(backend: ComputeBackend, operation: ComputeOperation) {
    super(`compute backend "${backend}" does not support ${operation} operations`)
    this.name = 'ComputeUnsupportedError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    compute: ComputeProvider
  }
}

/** The implementation callbacks a host supplies for a concrete backend. */
export interface ComputeProviderOperations {
  readonly acquire: (request: ComputeAcquireRequest) => Promise<ComputeLease>
  readonly execute: (lease: ComputeLease, request: ComputeRequest) => Promise<ComputeRunHandle>
  readonly status: (run: ComputeRunHandle) => Promise<ComputeRunSnapshot>
  readonly cancel: (run: ComputeRunHandle, reason?: string) => Promise<void>
  readonly release: (lease: ComputeLease) => Promise<void>
}

/**
 * Abstract compute service. A composition mounts exactly one implementation
 * behind `ctx.compute`; swapping EC2 for Sandpack changes the provider, not
 * the Web draft protocol, credential references, or consumers of this seam.
 */
export abstract class ComputeProvider extends Service {
  constructor(ctx: Context) {
    if (new.target === ComputeProvider) {
      throw new Error('@deepseek-ai/dsh-compute is the abstract compute seam; mount a concrete backend provider')
    }
    super(ctx, 'compute')
  }

  /** Backend identity used in diagnostics and deployment selection. */
  abstract readonly backend: ComputeBackend

  /** Bounded capabilities exposed to host and UI status surfaces. */
  abstract readonly capabilities: ComputeCapabilities

  /** Reserve bounded capacity for one workspace operation. */
  abstract acquire(request: ComputeAcquireRequest): Promise<ComputeLease>

  /** Start one exact command or preview request under a lease. */
  abstract execute(lease: ComputeLease, request: ComputeRequest): Promise<ComputeRunHandle>

  /** Read a bounded, non-consuming run snapshot. */
  abstract status(run: ComputeRunHandle): Promise<ComputeRunSnapshot>

  /** Request cancellation; providers must make the request idempotent. */
  abstract cancel(run: ComputeRunHandle, reason?: string): Promise<void>

  /** Release a lease and its backend-owned ephemeral resources. */
  abstract release(lease: ComputeLease): Promise<void>
}

/**
 * A small host adapter for testing and for integrations that already own the
 * remote client. It validates the seam's operation and backend fences while
 * delegating all storage, authentication, and process decisions to callbacks.
 */
export class DelegatingComputeProvider extends ComputeProvider {
  readonly backend: ComputeBackend
  readonly capabilities: ComputeCapabilities
  private readonly operations: ComputeProviderOperations

  constructor(
    ctx: Context,
    backend: ComputeBackend,
    capabilities: ComputeCapabilities,
    operations: ComputeProviderOperations,
  ) {
    super(ctx)
    this.backend = validateBackend(backend)
    this.capabilities = validateCapabilities(capabilities)
    this.operations = operations
  }

  async acquire(request: ComputeAcquireRequest): Promise<ComputeLease> {
    validateAcquireRequest(request)
    this.assertOperation(request.operation)
    const lease = await this.operations.acquire(request)
    assertLeaseBackend(lease, this.backend)
    return lease
  }

  async execute(lease: ComputeLease, request: ComputeRequest): Promise<ComputeRunHandle> {
    validateRequest(request)
    assertLeaseBackend(lease, this.backend)
    this.assertOperation(request.kind)
    const run = await this.operations.execute(lease, request)
    assertRunBackend(run, this.backend)
    if (run.leaseId !== lease.id) throw new Error('compute run does not belong to the supplied lease')
    return run
  }

  async status(run: ComputeRunHandle): Promise<ComputeRunSnapshot> {
    assertRunBackend(run, this.backend)
    const snapshot = await this.operations.status(run)
    assertRunBackend(snapshot.run, this.backend)
    if (snapshot.run.id !== run.id) throw new Error('compute status returned a different run')
    return snapshot
  }

  async cancel(run: ComputeRunHandle, reason?: string): Promise<void> {
    assertRunBackend(run, this.backend)
    await this.operations.cancel(run, reason)
  }

  async release(lease: ComputeLease): Promise<void> {
    assertLeaseBackend(lease, this.backend)
    await this.operations.release(lease)
  }

  private assertOperation(operation: ComputeOperation): void {
    if (!this.capabilities.operations.includes(operation)) {
      throw new ComputeUnsupportedError(this.backend, operation)
    }
  }
}

/** Resolve the backend explicitly; no EC2/Sandpack fallback is implicit. */
export function resolveComputeBackend(
  config: { readonly backend?: string } = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
): ComputeBackend {
  const value = config.backend ?? env.DSH_COMPUTE_BACKEND
  if (value === undefined || value.trim().length === 0) {
    throw new Error('set compute backend explicitly with config.backend or DSH_COMPUTE_BACKEND (ec2 or sandpack)')
  }
  return validateBackend(value)
}

/** Validate the operation request before any provider callback is invoked. */
export function validateRequest(request: ComputeRequest): void {
  switch (request.kind) {
    case 'command':
      if (request.argv.length === 0 || request.argv.some(argument => typeof argument !== 'string')) {
        throw new TypeError('compute command argv must contain at least one string')
      }
      validateOptionalPositiveInteger(request.timeoutMs, 'compute command timeoutMs')
      validateOptionalPositiveInteger(request.maxOutputBytes, 'compute command maxOutputBytes')
      if (request.cwd !== undefined) validateText(request.cwd, 'compute command cwd')
      return
    case 'preview':
      validateText(request.entry, 'compute preview entry')
      for (const [path, source] of Object.entries(request.files)) {
        validateText(path, 'compute preview file path')
        validateText(source, 'compute preview source for ' + path)
      }
      return
  }
}

function validateAcquireRequest(request: ComputeAcquireRequest): void {
  validateText(request.workspace.id, 'compute workspace id')
  if (request.workspace.revision !== undefined) validateText(request.workspace.revision, 'compute workspace revision')
  if (request.credentialRefs !== undefined) {
    for (const ref of request.credentialRefs) validateText(ref, 'compute credential reference')
  }
  validateOptionalPositiveInteger(request.maxDurationMs, 'compute lease maxDurationMs')
}

function validateBackend(backend: string): ComputeBackend {
  if (!/^[a-z][a-z0-9-]*$/u.test(backend)) {
    throw new TypeError(`compute backend "${backend}" must be a lowercase identifier`)
  }
  return backend
}

function validateCapabilities(capabilities: ComputeCapabilities): ComputeCapabilities {
  if (capabilities.operations.length === 0) throw new TypeError('compute provider must advertise an operation')
  if (!Number.isSafeInteger(capabilities.maxConcurrentRuns) || capabilities.maxConcurrentRuns < 1) {
    throw new TypeError('compute maxConcurrentRuns must be a positive safe integer')
  }
  return Object.freeze({
    ...capabilities,
    operations: Object.freeze([...new Set(capabilities.operations)]),
  })
}

function assertLeaseBackend(lease: ComputeLease, backend: ComputeBackend): void {
  if (lease.backend !== backend) throw new Error(`compute lease belongs to backend "${lease.backend}"`)
}

function assertRunBackend(run: ComputeRunHandle, backend: ComputeBackend): void {
  if (run.backend !== backend) throw new Error(`compute run belongs to backend "${run.backend}"`)
}

function validateOptionalPositiveInteger(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw new TypeError(`${field} must be a positive safe integer`)
}

function validateText(value: string, field: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\u0000')) throw new TypeError(`${field} must be a non-empty string without NUL`)
}

export default ComputeProvider
