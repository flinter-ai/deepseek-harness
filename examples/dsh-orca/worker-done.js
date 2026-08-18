/**
 * worker_done tool — the agent's native "I am finished" signal.
 *
 * Composes and runs:
 *   orca orchestration send --type worker_done --outcome <o> --task-id <t>
 *     --dispatch-id <d> --payload <json> [--files-modified <csv>] [--report-path <p>]
 *
 * A valid worker_done for the active taskId + dispatchId marks the task and
 * dispatch completed automatically (Orca-side; no extra bookkeeping here).
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { orcaContext } from './context.js'
import { buildWorkerDoneArgs, runOrca } from './orca-cli.js'
import { markWorkerDone } from './completion.js'

export function workerDoneTool(opts = {}) {
  const spawn = opts.runOrca ?? runOrca
  return defineTool({
    name: 'worker_done',
    description:
      'Report task completion to the Orca coordinator. Call ONCE when the assigned work is ' +
      'finished (success or failure): it routes to the Dispatch Run mailbox and marks the ' +
      'Orca task + dispatch complete. Include the bounded work evidence: tests run, files ' +
      'modified, gate status, unresolved dependencies, and the report path.',
    parameters: {
      outcome: {
        type: 'string',
        required: true,
        enum: ['succeeded', 'failed'],
        description: 'Whether the work completed successfully.',
      },
      summary: {
        type: 'string',
        required: true,
        description: 'Concise summary of what was done (5-20 words).',
      },
      tests: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tests run and their outcomes, e.g. "npm test: 42 passed".',
      },
      files_modified: {
        type: 'array',
        items: { type: 'string' },
        description: 'Paths of files changed or created.',
      },
      gates: {
        type: 'array',
        items: { type: 'string' },
        description: 'Gate names and status, e.g. "linear-reconcile: passed".',
      },
      dependencies: {
        type: 'array',
        items: { type: 'string' },
        description: 'Unresolved dependencies or external blockers, if any.',
      },
      report_path: {
        type: 'string',
        description: 'Path to the detailed work report file, if one was written.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          dispatchId: { type: 'string' },
          output: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `worker_done sent (${value.dispatchId ?? 'no dispatch'})` }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (exec.signal?.aborted) throw new Error('worker_done aborted before send')
      const ctx = orcaContext(process.env) // throws ORCA_CONTEXT_MISSING when not dispatched
      const argv = buildWorkerDoneArgs(ctx, args)
      const { stdout, stderr } = await spawn(argv, { timeoutMs: 60000 })
      markWorkerDone(ctx.dispatchId)
      return { ok: true, dispatchId: ctx.dispatchId, output: (stdout || stderr || 'worker_done sent').slice(0, 2000) }
    },
  })
}
