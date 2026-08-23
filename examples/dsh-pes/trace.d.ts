/**
 * Declarations for the runtime-owned searchable-trace emitter consumed by the
 * TS test surface; the runtime contract lives in trace.js.
 */

import type { PesResult } from './query.js'
import type { TraceAncestryContext } from './trace-record.js'

export const SIGNATURE_HEADER: 'x-dsh-signature'
export const TRACE_POST_CONTENT_TYPE: 'application/json'
export const TRACE_USER_AGENT: string
export const DEFAULT_TRACE_POST_TIMEOUT_MS: 10_000
export const MAX_TRACE_POST_TIMEOUT_MS: 60_000
export const TRACE_RUN_ORDINAL_BASE_DEFAULT: 0
export const TRACE_FIELD_ENV: Readonly<Record<string, readonly [string, string]>>
export const TRACE_ANCESTRY_FIELDS: readonly string[]

export type TraceEmitStatus =
  | 'disabled'
  | 'skipped'
  | 'duplicate'
  | 'accepted'
  | 'validation-rejected'
  | 'unauthorized'
  | 'conflict'
  | 'rejected'
  | 'unavailable'
  | 'unreachable'
  | 'unexpected'

export interface TraceEmitOutcome {
  status: TraceEmitStatus
  reason?: 'abstained' | 'error'
  id?: string
}

export interface ResolvedTraceConfig {
  enabled: boolean
  callbackUrl: string | undefined
  hmacSecret: string | undefined
  context: TraceAncestryContext | undefined
  runOrdinalBase: number
  postTimeoutMs: number
}

export interface TraceEmitter {
  enabled: boolean
  maybeEmit(result: PesResult): Promise<TraceEmitOutcome>
}

export function validateTraceConfig(config: Record<string, unknown>): void
export function resolveTraceConfig(
  config: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): ResolvedTraceConfig
export function classifyTraceResponse(status: unknown): TraceEmitStatus
export function isEligibleTraceResult(result: unknown): boolean
export function resultFingerprint(result: PesResult, enginePin: string | undefined): string
export function postTrace(
  callbackUrl: string,
  body: string,
  signature: string,
  timeoutMs: number,
): Promise<number>

export function createTraceEmitter(options: {
  traceConfig: ResolvedTraceConfig
  enginePin?: string
  post?: (callbackUrl: string, body: string, signature: string, timeoutMs: number) => Promise<number>
  logger?: Record<string, (message: string, meta?: unknown) => void>
}): TraceEmitter
