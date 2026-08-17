/**
 * Heartbeat support — the coordinator's liveness view.
 *
 * Orca's worker heartbeat is Dispatch-scoped: `orca orchestration send
 * --type heartbeat --task-id <t> --dispatch-id <d>` (omit --to, include both
 * IDs). The plugin sends one automatically every interval while a turn is
 * active (turn/start -> turn/end via the session/event firehose), so the
 * coordinator's `check --wait` never waits blind during long turns, and an
 * explicit `orca_heartbeat` tool lets the agent ping on demand.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { hasOrcaContext, orcaContext } from './context.js'
import { runOrca } from './orca-cli.js'

const timers = new Map() // session.id -> interval handle

export function heartbeatArgs(ctx) {
  return [
    'orchestration', 'send',
    '--run', ctx.runId,
    '--task-id', ctx.taskId,
    '--dispatch-id', ctx.dispatchId,
    '--type', 'heartbeat',
    '--subject', `heartbeat: ${ctx.taskId}`,
  ]
}

/** Send one heartbeat now (no-op when not Orca-dispatched). */
export function sendHeartbeat(spawn = runOrca) {
  if (!hasOrcaContext(process.env)) return Promise.resolve(false)
  const ctx = orcaContext(process.env)
  return spawn(heartbeatArgs(ctx), { timeoutMs: 15000 })
    .then(() => true)
    .catch((error) => {
      // Heartbeat failures are non-fatal (the worker keeps working).
      console.warn(`[dsh-orca] heartbeat failed: ${error.message}`)
      return false
    })
}

/** Install the automatic turn-active heartbeat. */
export function installHeartbeat(ctx, opts = {}) {
  const intervalMs = opts.intervalMs ?? 60000
  const spawn = opts.runOrca ?? runOrca
  const logger = ctx.logger
  const stop = (sessionId) => {
    const handle = timers.get(sessionId)
    if (handle !== undefined) {
      clearInterval(handle)
      timers.delete(sessionId)
    }
  }
  ctx.on('session/event', (session, event) => {
    if (event?.type === 'turn/start') {
      stop(session.id)
      const handle = setInterval(() => {
        sendHeartbeat(spawn).then((sent) => {
          if (logger && sent) logger.debug('[dsh-orca] heartbeat sent')
        })
      }, intervalMs)
      // Do not keep the harness process alive on heartbeats alone.
      handle.unref?.()
      timers.set(session.id, handle)
    } else if (event?.type === 'turn/end') {
      stop(session.id)
    }
  })
  return stop
}

/** Explicit on-demand heartbeat tool. */
export function orcaHeartbeatTool(opts = {}) {
  const spawn = opts.runOrca ?? runOrca
  return defineTool({
    name: 'orca_heartbeat',
    description:
      'Send a liveness heartbeat to the Orca coordinator while working. Call periodically ' +
      'during long-running steps so the coordinator can distinguish "alive and working" ' +
      'from "stalled". Heartbeats are auto-sent every 60s during an active turn; use this ' +
      'tool to ping on demand (e.g. before a long blocking step).',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sent: { type: 'boolean', required: true },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.sent ? 'heartbeat sent' : `heartbeat error: ${value.error ?? 'unknown'}` }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      try {
        const sent = await sendHeartbeat(spawn)
        return sent ? { sent: true } : { sent: false, error: 'no Orca dispatch context' }
      } catch (error) {
        return { sent: false, error: error.message }
      }
    },
  })
}
