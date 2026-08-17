/**
 * orca_check_inbox tool — the receive half of the loop (Orca -> agent).
 * Reads the Dispatch Run mailbox and surfaces coordinator messages to the
 * agent inside the harness. Peek is non-consuming by default; pass
 * ack_delivery_id to acknowledge the prior batch.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { orcaContext } from './context.js'
import { runOrca } from './orca-cli.js'

/** Simplify one wire message row into model-facing fields. */
export function simplifyMessage(row) {
  return {
    id: row.id,
    type: row.type ?? 'status',
    subject: row.subject ?? '',
    body: row.body ?? null,
    from: row.from_handle ?? null,
    priority: row.priority ?? 'normal',
    payload: row.payload ?? undefined,
    createdAt: row.created_at ?? null,
  }
}

/** Parse the CLI envelope into { ok, messages, count, runId, error }. */
export function parseCheckResult(stdout) {
  let envelope
  try {
    envelope = JSON.parse(stdout)
  } catch {
    return { ok: false, error: { code: 'bad-cli-output', message: 'orca check returned non-JSON' } }
  }
  if (envelope.ok !== true || envelope.result === undefined) {
    return { ok: false, error: envelope.error ?? { code: 'rpc-error', message: 'orca check failed' } }
  }
  const result = envelope.result
  const messages = Array.isArray(result.messages) ? result.messages.map(simplifyMessage) : []
  return { ok: true, messages, count: result.count ?? messages.length, runId: result.runId ?? null }
}

export function orcaCheckInboxTool(opts = {}) {
  const spawn = opts.runOrca ?? runOrca
  return defineTool({
    name: 'orca_check_inbox',
    description:
      'Read unread coordinator messages from the Orca run mailbox (the receive half of the ' +
      'orchestration loop). Peek is non-consuming; to acknowledge the prior batch, pass the ' +
      'delivery id returned by a previous non-peek check.',
    parameters: {
      ack_delivery_id: {
        type: 'string',
        description: 'If set, acknowledge this delivery id first (consuming check).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          messages: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                type: { type: 'string' },
                subject: { type: 'string' },
                body: { type: 'string' },
                from: { type: 'string' },
                priority: { type: 'string' },
                createdAt: { type: 'string' },
              },
            },
          },
          count: { type: 'integer' },
          runId: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.ok ? `${value.count} unread message(s)` : `inbox error: ${value.error ?? 'unknown'}` }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (exec.signal?.aborted) throw new Error('orca_check_inbox aborted before read')
      const ctx = orcaContext(process.env) // throws ORCA_CONTEXT_MISSING when not dispatched
      const argv = ['orchestration', 'check', '--run', ctx.runId]
      if (typeof args.ack_delivery_id === 'string' && args.ack_delivery_id.length > 0) {
        argv.push('--ack', args.ack_delivery_id)
      } else {
        argv.push('--peek')
      }
      argv.push('--json')
      let stdout
      try {
        ;({ stdout } = await spawn(argv, { timeoutMs: 30000 }))
      } catch (error) {
        const envelope = parseCheckResult(error.stdout ?? '')
        const code = envelope.ok ? 'cli-error' : (envelope.error?.code ?? 'cli-error')
        return { ok: false, messages: [], count: 0, runId: null, error: `${code}: ${envelope.error?.message ?? error.message}` }
      }
      const parsed = parseCheckResult(stdout)
      if (!parsed.ok) {
        return { ok: false, messages: [], count: 0, runId: null, error: `${parsed.error.code}: ${parsed.error.message ?? ''}` }
      }
      return { ok: true, messages: parsed.messages, count: parsed.count, runId: parsed.runId }
    },
  })
}
