/**
 * sampleFrames — deterministic frame sampler stub (internal).
 *
 * S0's frames.sample tool, internalized for S1: no external tool registers it;
 * the RUN_BASELINE_PHYSICS adapter calls this directly. Real implementation
 * will use DINOv2 self-similarity and Foote novelty; the stub proves the
 * capability → artifact chain inside the container.
 */

import { createHash } from 'node:crypto'

export function sampleFrames(window, budget = 12) {
  const artifact = {
    window,
    budget,
    frames: Array.from({ length: budget }, (_, i) => `frame_${i}`),
    note: 'stub — real sampler not wired',
  }
  const contentHash = createHash('sha256').update(JSON.stringify(artifact)).digest('hex')
  return { artifact, content_hash: contentHash }
}
