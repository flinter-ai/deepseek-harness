/**
 * @flinter/dsh-segment — S1 semantic-capability plugin for DeepSeek Harness.
 *
 * Registered as a bundle inside the GMI container by the flinter-dsh-worker
 * image. S1 supersedes the S0 prototype tool surface with ONE semantic
 * capability: RUN_BASELINE_PHYSICS. The five S0 prototype primitives are now
 * internal functions driven by the capability adapter; nothing else is
 * registered, so no capability looks callable unless it is.
 *
 * Every RUN_BASELINE_PHYSICS result is an explicitly abstained deterministic
 * stub (`abstention: 'prototype_stub'`) carrying provenance and a sha256
 * content_hash, so it can never be mistaken for real TowerH physics output.
 * No sampler, tracker, detector, VLM, or B2 integration is wired; no
 * production scientific capability is claimed.
 */

export const name = 'dsh-segment'
export const inject = ['tools']

import { defineTool } from '@deepseek-ai/dsh-tools'
import { createCapabilityRegistry } from './capabilities/registry.js'
import {
  RUN_BASELINE_PHYSICS,
  createRunBaselinePhysicsAdapter,
  runBaselinePhysicsInput,
  runBaselinePhysicsResult,
} from './capabilities/run-baseline-physics.js'

export function apply(ctx, config = {}) {
  if (config.out_dir !== undefined && typeof config.out_dir !== 'string') {
    throw new TypeError('[dsh-segment] config.out_dir must be a string when set')
  }
  const registry = createCapabilityRegistry()
  const unregisterCapability = registry.register(
    RUN_BASELINE_PHYSICS,
    createRunBaselinePhysicsAdapter({ outDir: config.out_dir }),
  )
  const unregisterTool = ctx.tools.register(defineTool({
    name: RUN_BASELINE_PHYSICS,
    description: 'Run the S1 prototype baseline-physics capability: sample frames, track them, detect candidate boundaries, and write the deterministic stub artifact. Results are abstained (prototype_stub) with provenance — never treat as production physics output.',
    parameters: runBaselinePhysicsInput,
    output: {
      schema: runBaselinePhysicsResult,
      render: (_args, value) => [{ type: 'text', text: `RUN_BASELINE_PHYSICS → ${value.content_hash.slice(0, 12)}` }],
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      return registry.execute(RUN_BASELINE_PHYSICS, args)
    },
  }))

  const logger = ctx.logger
  if (logger) logger.info(`[dsh-segment] plugin loaded: semantic capability ${RUN_BASELINE_PHYSICS}; prototype primitives are internal`)
  ctx.on('dispose', () => {
    unregisterTool()
    unregisterCapability()
  })
}
