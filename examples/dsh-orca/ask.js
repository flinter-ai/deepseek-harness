/**
 * orca_ask tool — ask the coordinator a question and wait for the answer.
 *
 * Two modes:
 *   block: true  -> `orca orchestration ask --question ... [--options csv]`
 *                   (blocking; requires an active supervised Dispatch — E2
 *                    workers run under one). Timeout leaves the question
 *                    pending; resume with the returned message id.
 *   block: false -> `orca orchestration send --type question --subject ...`
 *                   (non-blocking; returns the message id immediately).
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { orcaContext } from './context.js'
import { runOrca } from './orca-cli.js'

export function orcaAskTool(opts = {}) {
  const spawn = opts.runOrca ?? runOrca
  return defineTool({
    name: 'orca_ask',
    description:
      'Ask the Orca coordinator a question and, in blocking mode, wait for the answer. ' +
      'Use for decision gates that must pause the workflow. Blocking mode requires an ' +
      'active dispatch (E2 workers have one). A blocking timeout leaves the question ' +
      'pending — resume by the returned message id.',
    parameters: {
      question: {
        type: 'string',
        required: true,
        description: 'The question for the coordinator.',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional answer choices presented to the coordinator.',
      },
      block: {
        type: 'boolean',
        description: 'Block for the answer (default true). false sends a non-blocking question message.',
      },
      timeout_ms: {
        type: 'integer',
        description: 'Blocking wait in milliseconds (default 120000).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          answer: { type: 'string' },
          messageId: { type: 'string' },
          pending: { type: 'boolean' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.ok ? (value.answer ?? `sent (${value.messageId ?? ''})`) : `ask error: ${value.error ?? 'unknown'}` }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (exec.signal?.aborted) throw new Error('orca_ask aborted before send')
      const ctx = orcaContext(process.env) // throws ORCA_CONTEXT_MISSING when not dispatched
      const block = args.block !== false
      if (!block) {
        // Non-blocking question message.
        const argv = [
          'orchestration', 'send',
          '--run', ctx.runId,
          '--to', `run:${ctx.runId}`,
          '--type', 'question',
          '--subject', args.question,
          '--payload', JSON.stringify({ fromWorker: ctx.dispatchId }),
          '--json',
        ]
        try {
          const { stdout } = await spawn(argv, { timeoutMs: 30000 })
          const envelope = JSON.parse(stdout)
          return {
            ok: true,
            messageId: envelope?.result?.message?.id ?? null,
            pending: false,
          }
        } catch (error) {
          return { ok: false, messageId: null, pending: false, error: error.message }
        }
      }
      // Blocking ask.
      const argv = ['orchestration', 'ask', '--run', ctx.runId, '--question', args.question]
      if (Array.isArray(args.options) && args.options.length > 0) argv.push('--options', args.options.join(','))
      argv.push('--timeout-ms', String(args.timeout_ms ?? 120000))
      argv.push('--json')
      try {
        const { stdout } = await spawn(argv, { timeoutMs: (args.timeout_ms ?? 120000) + 15000 })
        const envelope = JSON.parse(stdout)
        const result = envelope?.result ?? {}
        const answer = result.answer ?? result.body ?? result.reply ?? null
        return { ok: true, answer, messageId: result.messageId ?? result.message?.id ?? null, pending: false }
      } catch (error) {
        // Timeout leaves the question pending with an id in the error envelope.
        let envelope
        try { envelope = JSON.parse(error.stdout ?? '') } catch { envelope = null }
        const messageId = envelope?.error?.messageId ?? envelope?.result?.messageId ?? null
        return {
          ok: false,
          messageId,
          pending: messageId != null,
          error: `${envelope?.error?.code ?? 'ask-error'}: ${envelope?.error?.message ?? error.message}`,
        }
      }
    },
  })
}
