/**
 * detectBoundaries — deterministic boundary detector stub (internal).
 *
 * S0's boundary.detect tool, internalized for S1: no external tool registers
 * it; the RUN_BASELINE_PHYSICS adapter calls this directly with the track
 * artifact's content hash. Real implementation will use Foote novelty on
 * self-similarity; the stub proves candidate emission.
 */

import { createHash } from 'node:crypto'

export function detectBoundaries(trackRef) {
  const artifact = {
    track_ref: trackRef,
    candidates: [
      { t: '00:12', score: 0.81, kind: 'state_change' },
      { t: '00:47', score: 0.66, kind: 'state_change' },
    ],
    note: 'stub — real detector not wired',
  }
  const contentHash = createHash('sha256').update(JSON.stringify(artifact)).digest('hex')
  return { artifact, content_hash: contentHash }
}
