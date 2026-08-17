/**
 * Orca CLI composition + spawn (v1 transport: spawn the `orca` CLI, which RPCs
 * the local daemon over its unix socket). v2 (future): talk to the daemon
 * socket directly to drop the CLI/sandbox dependency.
 */
import { execFile } from 'node:child_process'

/**
 * Compose the `orca orchestration send` argv for a worker_done signal.
 *
 * Per the `orchestration` skill: worker_done is an exact-Dispatch signal.
 * We omit `--to` so it routes to the Dispatch's owning Run mailbox, and omit
 * `--from` so the runtime auto-resolves the sender (E2: the agent runs inside
 * the Orca terminal). A valid worker_done auto-completes the task + dispatch.
 *
 * @param ctx - validated DSH_ORCA_* context.
 * @param args - tool arguments (outcome/summary/tests/files/gates/dependencies/report_path).
 * @returns argv ready for `execFile('orca', argv)`.
 */
export function buildWorkerDoneArgs(ctx, args) {
  // The CLI rejects `--payload` combined with ANY structured payload flag
  // (task-id/dispatch-id/outcome/files-modified/report-path/phase). worker_done
  // needs the structured IDs for routing, so the work evidence (summary, tests,
  // gates, dependencies) travels in --body as a compact JSON string.
  const evidence = {
    summary: args.summary,
    ...(Array.isArray(args.tests) ? { tests: args.tests } : {}),
    ...(Array.isArray(args.gates) ? { gates: args.gates } : {}),
    ...(Array.isArray(args.dependencies) ? { dependencies: args.dependencies } : {}),
  }
  const argv = [
    'orchestration', 'send',
    '--run', ctx.runId,
    '--task-id', ctx.taskId,
    '--dispatch-id', ctx.dispatchId,
    '--subject', `worker_done: ${ctx.taskId}`,
    '--type', 'worker_done',
    '--outcome', args.outcome,
    '--body', JSON.stringify(evidence),
  ]
  if (Array.isArray(args.files_modified) && args.files_modified.length > 0) {
    argv.push('--files-modified', args.files_modified.join(','))
  }
  if (typeof args.report_path === 'string' && args.report_path.length > 0) {
    argv.push('--report-path', args.report_path)
  }
  return argv
}

/**
 * Spawn `orca <argv...>` and resolve with captured output.
 * @param argv - CLI arguments after the `orca` executable.
 * @param opts - timeoutMs and maxBuffer.
 */
export function runOrca(argv, opts = {}) {
  const { timeoutMs = 60000, maxBuffer = 4 * 1024 * 1024 } = opts
  return new Promise((resolve, reject) => {
    execFile('orca', argv, { timeout: timeoutMs, maxBuffer }, (error, stdout, stderr) => {
      if (error) {
        const out = stdout?.toString() ?? ''
        const err = (stderr || error.message || '').toString().trim()
        const wrapped = new Error(`orca ${argv.join(' ')} failed: ${err}`)
        // Preserve the CLI's JSON envelope (printed to stdout on business errors)
        // so callers can surface machine codes like run_not_found.
        wrapped.stdout = out
        wrapped.stderr = err
        reject(wrapped)
        return
      }
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
    })
  })
}
