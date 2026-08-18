/**
 * Lifecycle safety net: when the ROOT worker agent session is disposed without
 * the agent having called worker_done explicitly, send ONE conservative signal
 * so the dispatch does not hang silently forever.
 *
 * Root-only rule: `agent/disposed` events for child (subagent) sessions bubble
 * to this scope. Only the root worker agent's dispose may complete the
 * dispatch — a subagent finishing is normal fan-out, never the worker's end.
 *
 * CRITICAL: the auto net must NEVER claim success. Absence of an explicit
 * worker_done means the work is UNVERIFIED, so the auto signal is always
 * `outcome: failed` with an AUTO-INCOMPLETE marker. The coordinator inspects
 * artifacts and reopens with a reason if warranted — it never trusts an
 * auto signal as completion. This mirrors the FLINTER principle that gates
 * stay NOT_RUN until real evidence exists.
 */
import { hasOrcaContext, orcaContext } from './context.js'
import { buildWorkerDoneArgs, runOrca } from './orca-cli.js'
import { markWorkerDone, workerDoneSent } from './completion.js'

/** Extract the final assistant text from a session log, if any. */
export function lastAssistantSummary(session) {
  const events = session?.events ?? []
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type !== 'assistant/message') continue
    const message = event.data?.message
    const blocks = Array.isArray(message?.content) ? message.content : []
    const text = blocks
      .map((block) => (typeof block?.text === 'string' ? block.text : ''))
      .filter(Boolean)
      .join(' ')
      .trim()
    if (text.length > 0) return text.slice(0, 2000)
  }
  return undefined
}

/** Whether the session log shows a terminal error (agent/error or error turn end). */
export function endedWithError(session) {
  const events = session?.events ?? []
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type === 'agent/error') return true
    if (event?.type === 'turn/end' && event.data?.reason?.kind === 'error') return true
  }
  return false
}

/**
 * Install the auto-send hook on `agent/disposed`.
 * @param ctx - the plugin context (root/app scope receives bubbled agent events).
 * @param opts - injectable spawn (testability) — defaults to the real CLI spawn.
 */
export function installLifecycleHook(ctx, opts = {}) {
  const spawn = opts.runOrca ?? runOrca
  const logger = ctx.logger
  // The root worker agent is the FIRST agent created in this process. Every
  // later `agent/disposed` (subagent fan-out) must NOT complete the dispatch.
  let rootAgent = null
  ctx.on('agent/created', (payload) => {
    if (!rootAgent && payload?.agent) rootAgent = payload.agent
  })
  ctx.on('agent/disposed', (payload) => {
    const agent = payload?.agent
    try {
      if (!hasOrcaContext(process.env)) return // not an Orca-dispatched run: no-op
      const orca = orcaContext(process.env)
      if (workerDoneSent(orca.dispatchId)) return // explicit worker_done already sent
      if (rootAgent && agent !== rootAgent) return // subagent dispose: not the worker's end
      if (!rootAgent) {
        // Root identity never observed; refuse to guess. A false completion
        // is worse than a hang the coordinator can detect via heartbeat loss.
        if (logger) logger.warn('[dsh-orca] lifecycle: root agent unknown; skipping auto worker_done')
        return
      }
      // Never derive "succeeded" from absence of error: an aborted, idle, or
      // context-limited session has not proven its work. Report failed (Orca's
      // worker_done has only succeeded|failed) with an AUTO-INCOMPLETE marker.
      const summary = 'AUTO-INCOMPLETE (no explicit worker_done): '
        + (lastAssistantSummary(agent?.session) ?? 'agent session ended')
      const argv = buildWorkerDoneArgs(orca, {
        outcome: 'failed',
        summary,
        tests: [],
        gates: [],
        dependencies: [],
        files_modified: [],
      })
      spawn(argv, { timeoutMs: 60000 })
        .then(() => {
          markWorkerDone(orca.dispatchId)
          if (logger) logger.info(`[dsh-orca] auto worker_done sent for ${orca.dispatchId}`)
        })
        .catch((error) => {
          if (logger) logger.warn(`[dsh-orca] auto worker_done failed: ${error.message}`)
        })
    } catch (error) {
      if (logger) logger.warn(`[dsh-orca] lifecycle hook error: ${error.message}`)
    }
  })
}
