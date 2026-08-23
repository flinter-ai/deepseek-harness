/**
 * RUN_BASELINE_PHYSICS — the S1 semantic capability of @flinter/dsh-segment.
 *
 * The registered adapter drives the internalized S0 prototype primitives
 * (sampleFrames → trackWindow → detectBoundaries → writeArtifact) and wraps
 * the composed deterministic stub artifact in a typed result envelope. Every
 * result is explicitly abstained (`abstention: 'prototype_stub'`) and carries
 * provenance with each internal stage's content hash, so it can never be
 * mistaken for real TowerH physics output.
 *
 * The input schema doubles as the registered tool's parameter schema and the
 * result schema as its output schema; both are honored end-to-end by the tools
 * registry. The artifact path is runtime-owned: plugin config wins, then the
 * runtime env, then the module constant — never a model-visible request knob.
 */

import { createHash } from 'node:crypto'
import { sampleFrames } from '../tools/frames-sample.js'
import { trackWindow } from '../tools/track-cotracker.js'
import { detectBoundaries } from '../tools/boundary-detect.js'
import { writeArtifact } from '../tools/artifact-write.js'

export const RUN_BASELINE_PHYSICS = 'RUN_BASELINE_PHYSICS'
export const RUN_BASELINE_PHYSICS_RESULT_SCHEMA_VERSION = 'run-baseline-physics-result.v1'
export const ABSTENTION_PROTOTYPE_STUB = 'prototype_stub'
export const DEFAULT_ARTIFACT_NAME = 'baseline-physics.json'
export const DEFAULT_ARTIFACT_OUT_DIR = '/tmp/dsh-segment-artifacts'
export const DEFAULT_FRAME_BUDGET = 12

/** Typed semantic request: model-visible knobs only. The artifact path is
 *  runtime/config-owned (plugin config -> env -> module default) and is never
 *  a request parameter; a model-supplied `out_dir` is ignored (see the
 *  keyless smoke's ownership assertion). */
export const runBaselinePhysicsInput = {
  window: { type: 'string', required: true, description: 'Video window identifier, e.g. "t0-t1"' },
  budget: { type: 'number', description: 'Frame sample budget', default: DEFAULT_FRAME_BUDGET },
}

/** Typed semantic result: provenance + abstention + content_hash envelope. */
export const runBaselinePhysicsResult = {
  type: 'object',
  additionalProperties: false,
  properties: {
    capability_id: {
      type: 'string', required: true, enum: [RUN_BASELINE_PHYSICS],
      description: 'The executed capability id',
    },
    schema_version: {
      type: 'string', required: true,
      description: 'Semantic result schema version',
    },
    status: {
      type: 'string', required: true, enum: ['completed'],
      description: 'Invocation outcome; a completed run may still be abstained',
    },
    abstention: {
      type: 'string', required: true, enum: [ABSTENTION_PROTOTYPE_STUB],
      description: 'Explicit abstention marker: this output is a deterministic prototype stub, not TowerH physics',
    },
    provenance: {
      type: 'object', required: true, additionalProperties: false,
      properties: {
        plugin: { type: 'string', required: true, description: 'Producing plugin package' },
        milestone: { type: 'string', required: true, description: 'Producing milestone' },
        stages: {
          type: 'array', required: true,
          description: 'Internal S0 prototype stages run, in order, with their artifact content hashes',
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              stage: { type: 'string', required: true, description: 'Internal prototype stage name' },
              content_hash: { type: 'string', required: true, description: 'sha256 hex over the stage artifact payload' },
            },
          },
        },
      },
    },
    output: {
      type: 'object', required: true, additionalProperties: true,
      description: 'Composed deterministic stub artifact payload (frames, track, candidates)',
    },
    artifact: {
      type: 'object', required: true, additionalProperties: false,
      properties: {
        name: { type: 'string', required: true, description: 'Written artifact name' },
        content_hash: { type: 'string', required: true, description: 'sha256 hex over the written artifact bytes' },
      },
    },
    content_hash: {
      type: 'string', required: true,
      description: 'sha256 hex over canonical JSON of every other envelope field',
    },
  },
}

export function createRunBaselinePhysicsAdapter({ outDir } = {}) {
  return {
    execute(request) {
      return runBaselinePhysics(request, outDir)
    },
  }
}

function runBaselinePhysics(request, configOutDir) {
  const window = request.window
  const budget = request.budget ?? DEFAULT_FRAME_BUDGET
  const outDir = configOutDir ?? DEFAULT_ARTIFACT_OUT_DIR

  const frames = sampleFrames(window, budget)
  const track = trackWindow(window, frames.artifact.frames)
  const candidates = detectBoundaries(track.content_hash)
  const payload = { frames: frames.artifact, track: track.artifact, candidates: candidates.artifact }
  const artifact = writeArtifact(DEFAULT_ARTIFACT_NAME, payload, outDir)

  const envelope = {
    capability_id: RUN_BASELINE_PHYSICS,
    schema_version: RUN_BASELINE_PHYSICS_RESULT_SCHEMA_VERSION,
    status: 'completed',
    abstention: ABSTENTION_PROTOTYPE_STUB,
    provenance: {
      plugin: '@flinter/dsh-segment',
      milestone: 'S1',
      stages: [
        { stage: 'frames.sample', content_hash: frames.content_hash },
        { stage: 'track.cotracker', content_hash: track.content_hash },
        { stage: 'boundary.detect', content_hash: candidates.content_hash },
        { stage: 'artifact.write', content_hash: artifact.content_hash },
      ],
    },
    output: payload,
    artifact: { name: artifact.artifact.name, content_hash: artifact.content_hash },
  }
  const contentHash = createHash('sha256').update(JSON.stringify(envelope)).digest('hex')
  return { ...envelope, content_hash: contentHash }
}
