/**
 * Declarations for the plain-JS engine seam consumed by the TS test surface;
 * the runtime contract lives in engine.js.
 */

export type EngineErrorKind =
  | 'engine-unavailable'
  | 'engine-timeout'
  | 'engine-nonzero-exit'
  | 'engine-malformed-response'
  | 'malformed-input'

export interface StructuredEngineError {
  kind: EngineErrorKind
  message: string
  engine_error?: string
  line?: number
  exit_code?: number
  stderr?: string
  command?: string[]
}

export interface EngineInvocationOptions {
  eventsPath: string
  timeoutMs: number
  env: NodeJS.ProcessEnv
}

export type EngineQueryOutcome =
  | { ok: true; response: Record<string, unknown> }
  | { ok: false; error: StructuredEngineError }

export interface ResolvedEngineConfig {
  command: string[]
  eventsPath: string | undefined
  timeoutMs: number
  artifactsRoot: string | undefined
  enginePin: string | undefined
}

export const ENGINE_PROTOCOL: 'event_index.query stdin-jsonl v1'
export const DEFAULT_ENGINE_COMMAND: readonly string[]
export const DEFAULT_TIMEOUT_MS: 30_000
export const MAX_TIMEOUT_MS: 120_000
export const MAX_STDOUT_BYTES: number
export const MAX_STDERR_BYTES: number

export function resolveEventsPath(config: { events?: string }, env: NodeJS.ProcessEnv): string | undefined
export function resolveEngineArgv(command: string[], eventsPath: string): string[]
export function validateEngineConfig(config: Record<string, unknown>): void
export function resolveEngineConfig(config: Record<string, unknown>, env: NodeJS.ProcessEnv): ResolvedEngineConfig
export function parseSingleResponse(stdout: string): { response: Record<string, unknown> } | { problem: string }
export function envelopeViolation(response: Record<string, unknown>): string | null
export function spawnEngineQuery(
  command: string[],
  request: Record<string, unknown>,
  options: EngineInvocationOptions,
): Promise<EngineQueryOutcome>
