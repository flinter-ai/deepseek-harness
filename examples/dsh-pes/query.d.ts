/**
 * Declarations for the plain-JS query runner consumed by the TS test surface;
 * the runtime contract lives in query.js.
 */

import type { ParameterSchemaSpec, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { ResolvedEngineConfig, StructuredEngineError } from './engine.js'
import type { TraceEmitter } from './trace.js'

export const SEARCH_EVENTS: 'search_events'
export const FIND_SIMILAR_STATES: 'find_similar_states'
export const FIND_COUNTERFACTUALS: 'find_counterfactuals'
export const ZOOM: 'zoom'
export const RESULT_SCHEMA_VERSION: 'dsh-pes-result.v1'
export const DEFAULT_RESULT_N: 3
export const MAX_RESULT_N: 50

export interface PesProvenance {
  plugin: '@flinter/dsh-pes'
  engine: 'event_index.query'
  engine_protocol: 'event_index.query stdin-jsonl v1'
  engine_pin?: string
}

export interface MissingArtifactReference {
  event_id: string
  source_path: string
}

export interface PesResultError extends StructuredEngineError {
  kind: StructuredEngineError['kind'] | 'artifact-reference-missing'
  message: string
  engine_error?: string
  line?: number
  exit_code?: number
  stderr?: string
  missing?: MissingArtifactReference[]
  command?: string[]
}

export interface PesResult {
  tool: 'search_events' | 'find_similar_states' | 'find_counterfactuals' | 'zoom'
  schema_version: 'dsh-pes-result.v1'
  status: 'completed' | 'abstained' | 'error'
  mode: 'search' | 'similar' | 'counterfactual' | 'zoom'
  count: number
  bounded: true
  event_ids: string[]
  events: Array<Record<string, unknown>>
  abstained: boolean
  artifact_verification: 'verified' | 'unconfigured'
  provenance: PesProvenance
  query?: string
  state?: { holding?: string[]; on_surface?: string[] }
  outcome?: string
  episode?: string
  t_start?: number
  t_end?: number
  n?: number
  error?: PesResultError
}

export const searchEventsInput: ParameterSchemaSpec
export const findSimilarStatesInput: ParameterSchemaSpec
export const findCounterfactualsInput: ParameterSchemaSpec
export const zoomInput: ParameterSchemaSpec

export function dshPesResultFor(
  tool: 'search_events' | 'find_similar_states' | 'find_counterfactuals' | 'zoom',
  mode: 'search' | 'similar' | 'counterfactual' | 'zoom',
): ValueSchemaSpec

export function buildEngineRequest(
  tool: string,
  args: Record<string, unknown>,
): { mode: string; request: Record<string, unknown> } | { problem: string }

export function verifyArtifactReferences(
  events: Array<Record<string, unknown>>,
  artifactsRoot: string | undefined,
): { unconfigured: boolean; missing: MissingArtifactReference[] }

export function runQuery(
  tool: 'search_events' | 'find_similar_states' | 'find_counterfactuals' | 'zoom',
  args: Record<string, unknown>,
  config: ResolvedEngineConfig,
  trace?: TraceEmitter,
): Promise<PesResult>
