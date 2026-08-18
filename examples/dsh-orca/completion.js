/**
 * Per-session completion state: remembers that worker_done was already sent
 * for a dispatch, so the lifecycle safety net never double-reports. Keyed by
 * dispatchId (per-process; a fresh harness process starts a clean slate).
 */
const sent = new Set()

/** Record an explicit worker_done for the dispatch. */
export function markWorkerDone(dispatchId) {
  sent.add(dispatchId)
}

/** Whether an explicit worker_done was already sent for the dispatch. */
export function workerDoneSent(dispatchId) {
  return sent.has(dispatchId)
}
