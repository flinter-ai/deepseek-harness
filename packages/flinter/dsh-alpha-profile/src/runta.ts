import type { DshComputeBackendAdapter, DshComputeExecutionSpec, DshComputeProcess } from './compute.ts'

/** Runtime state returned by an injected Runta control client. */
export type RuntaRuntimeState = 'ready' | 'sleeping' | 'starting' | 'stopped'

/** The small Runta control surface required by the DSH adapter. */
export interface RuntaRuntime {
  inspect(runtimeId: string): Promise<Readonly<{ state: RuntaRuntimeState }>>
  wake(runtimeId: string): Promise<void>
  exec(runtimeId: string, spec: DshComputeExecutionSpec): Promise<DshComputeProcess>
  stop(runtimeId: string): Promise<void>
}

/** Options for the bounded, runtime-id-addressed Runta adapter. */
export interface RuntaComputeBackendOptions {
  readonly runtime: RuntaRuntime
  readonly runtimeId: string
  readonly readinessTimeoutMs?: number
  readonly readinessPollMs?: number
}

function requiredText(value: string, field: string): string {
  if (value.trim().length === 0 || value.includes('\u0000')) throw new Error(`runta ${field} is required`)
  return value.trim()
}

function positive(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`runta ${field} must be a positive safe integer`)
  return value
}

const wait = (milliseconds: number): Promise<void> => new Promise(resolve => setTimeout(resolve, milliseconds))

/** Runta adapter with explicit runtime identity and bounded wake readiness. */
export class RuntaComputeBackend implements DshComputeBackendAdapter {
  readonly backend = 'runta' as const
  private readonly options: RuntaComputeBackendOptions & { readonly readinessTimeoutMs: number; readonly readinessPollMs: number }

  constructor(options: RuntaComputeBackendOptions) {
    this.options = {
      ...options,
      runtimeId: requiredText(options.runtimeId, 'runtimeId'),
      readinessTimeoutMs: positive(options.readinessTimeoutMs ?? 30_000, 'readinessTimeoutMs'),
      readinessPollMs: positive(options.readinessPollMs ?? 250, 'readinessPollMs'),
    }
  }

  async start(spec: DshComputeExecutionSpec): Promise<DshComputeProcess> {
    const { runtime, runtimeId, readinessTimeoutMs, readinessPollMs } = this.options
    const initial = await runtime.inspect(runtimeId)
    if (initial.state !== 'ready') await runtime.wake(runtimeId)
    const deadline = Date.now() + readinessTimeoutMs
    while ((await runtime.inspect(runtimeId)).state !== 'ready') {
      if (Date.now() >= deadline) throw new Error(`runta runtime did not become ready: ${runtimeId}`)
      await wait(Math.min(readinessPollMs, Math.max(1, deadline - Date.now())))
    }
    const process = await runtime.exec(runtimeId, spec)
    let stopped = false
    return {
      waitUntilComplete: async () => process.waitUntilComplete(),
      stop: async () => {
        if (stopped) return
        stopped = true
        try { await process.stop() } finally { await runtime.stop(runtimeId) }
      },
    }
  }
}
