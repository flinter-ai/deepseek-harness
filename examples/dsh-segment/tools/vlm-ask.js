/**
 * askVlm — VLM state-question stub (internal, not yet reached by any S1
 * capability).
 *
 * S0's vlm.ask tool, internalized for S1: no external tool registers it, and
 * the RUN_BASELINE_PHYSICS adapter does not call it — baseline physics does
 * not ask state questions. It stays as the frozen primitive later semantic
 * capabilities (state-verification tracks) will drive. Real implementation
 * will call ARK/doubao with frames and a state question.
 */

import { createHash } from 'node:crypto'

export function askVlm(framesRef, question) {
  const artifact = {
    frames_ref: framesRef,
    question,
    answer: 'unknown — stub VLM',
    reasoning_effort: 'low',
    note: 'stub — real VLM not wired',
  }
  const contentHash = createHash('sha256').update(JSON.stringify(artifact)).digest('hex')
  return { artifact, content_hash: contentHash }
}
