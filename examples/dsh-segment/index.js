/**
 * @flinter/dsh-segment — S0 prototype segment plugin for DeepSeek Harness.
 *
 * Registered as a bundle inside the GMI container by the flinter-dsh-worker
 * image. Provides deterministic stub instruments and judgement tools for
 * episode segmentation. The agent loop runs inside DSH; FLINTER supplies the
 * instruments and the judgement policy.
 *
 * S0 scope is a prototype/reference skeleton only: each tool returns a stub
 * artifact with a content hash so the container boot → tool call → artifact
 * write path can be proven without TowerH/TowerT integration. No sampler,
 * tracker, detector, VLM, or B2 integration is wired; no production
 * scientific capability is claimed.
 *
 * The S0 acceptance contract is: the plugin loads from a clean checkout, the
 * headless profile discovers it, and every registered tool accepts valid
 * input and returns a schema-valid deterministic stub result.
 */

export const name = 'dsh-segment'
export const inject = ['tools']

import { framesSampleTool } from './tools/frames-sample.js'
import { trackCotrackerTool } from './tools/track-cotracker.js'
import { boundaryDetectTool } from './tools/boundary-detect.js'
import { vlmAskTool } from './tools/vlm-ask.js'
import { artifactWriteTool } from './tools/artifact-write.js'

export function apply(ctx, config = {}) {
  ctx.tools.register(framesSampleTool())
  ctx.tools.register(trackCotrackerTool())
  ctx.tools.register(boundaryDetectTool())
  ctx.tools.register(vlmAskTool())
  ctx.tools.register(artifactWriteTool())
  const logger = ctx.logger
  if (logger) logger.info('[dsh-segment] plugin loaded: frames.sample, track.cotracker, boundary.detect, vlm.ask, artifact.write')
}
