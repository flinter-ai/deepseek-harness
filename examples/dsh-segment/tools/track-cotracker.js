/**
 * trackWindow — deterministic tracker stub (internal).
 *
 * S0's track.cotracker tool, internalized for S1: no external tool registers
 * it; the RUN_BASELINE_PHYSICS adapter calls this directly with the sampled
 * frame ids as seeds. Real implementation will run CoTracker inside the
 * container; the stub proves the tracked-artifact hash chain.
 */

import { createHash } from 'node:crypto'

export function trackWindow(window, seeds) {
  const artifact = {
    window,
    seeds,
    tracks: seeds.map((seed) => ({ seed, points: [] })),
    note: 'stub — real tracker not wired',
  }
  const contentHash = createHash('sha256').update(JSON.stringify(artifact)).digest('hex')
  return { artifact, content_hash: contentHash }
}
