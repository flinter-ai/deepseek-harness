/**
 * Declarations for the plain-JS RUN_BASELINE_PHYSICS capability module
 * consumed by the TS test surface; the runtime contract lives in
 * run-baseline-physics.js.
 */

import type { ParameterSchemaSpec, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

export const RUN_BASELINE_PHYSICS: 'RUN_BASELINE_PHYSICS'
export const RUN_BASELINE_PHYSICS_RESULT_SCHEMA_VERSION: 'run-baseline-physics-result.v1'
export const ABSTENTION_PROTOTYPE_STUB: 'prototype_stub'
export const DEFAULT_ARTIFACT_NAME: 'baseline-physics.json'
export const DEFAULT_ARTIFACT_OUT_DIR: '/tmp/dsh-segment-artifacts'
export const DEFAULT_FRAME_BUDGET: 12
/** The frame budget must be a positive integer. */
export const FRAME_BUDGET_MIN: 1
/** The complete model-visible request contract: exactly these two keys. */
export const REQUEST_KEYS: readonly ['window', 'budget']

/** Fail-closed request violation from the RUN_BASELINE_PHYSICS adapter. */
export class CapabilityRequestError extends Error {
  constructor(message: string)
}

export interface RunBaselinePhysicsRequest {
  window: string
  budget?: number
}

export interface RunBaselinePhysicsStage {
  stage: string
  content_hash: string
}

export interface RunBaselinePhysicsProvenance {
  plugin: string
  milestone: string
  stages: RunBaselinePhysicsStage[]
}

export interface RunBaselinePhysicsResult {
  capability_id: 'RUN_BASELINE_PHYSICS'
  schema_version: 'run-baseline-physics-result.v1'
  status: 'completed'
  abstention: 'prototype_stub'
  provenance: RunBaselinePhysicsProvenance
  output: Record<string, unknown>
  artifact: { name: string; content_hash: string }
  content_hash: string
}

export interface RunBaselinePhysicsAdapter {
  execute(request: RunBaselinePhysicsRequest): RunBaselinePhysicsResult
}

export const runBaselinePhysicsInput: ParameterSchemaSpec
export const runBaselinePhysicsResult: ValueSchemaSpec

export function createRunBaselinePhysicsAdapter(options?: { outDir?: string }): RunBaselinePhysicsAdapter
