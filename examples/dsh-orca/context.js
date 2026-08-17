/**
 * Orca orchestration context loader.
 *
 * The orchestrator creates Run -> Task -> Dispatch (per the `orchestration`
 * skill), then launches the harness with the dispatch context in the env:
 *
 *   DSH_ORCA_RUN_ID          run_...        run namespace/inbox
 *   DSH_ORCA_TASK_ID         task_...       the DAG task this worker owns
 *   DSH_ORCA_DISPATCH_ID     dispatch_...   the attempt identity (lineage/retry)
 *   DSH_ORCA_COORDINATOR     <handle>       coordinator handle for --from
 *
 * Every Orca-bound tool requires this context. Absence is an actionable error,
 * not a silent no-op: the agent should refuse to claim completion.
 */

export const ORCA_ENV = Object.freeze({
  runId: 'DSH_ORCA_RUN_ID',
  taskId: 'DSH_ORCA_TASK_ID',
  dispatchId: 'DSH_ORCA_DISPATCH_ID',
  coordinator: 'DSH_ORCA_COORDINATOR',
})

/**
 * Read and validate the orchestration context from the environment.
 * @param env - environment source (defaults to process.env) for testability.
 * @returns the frozen validated context.
 * @throws {Error} with code ORCA_CONTEXT_MISSING listing absent variables.
 */
export function orcaContext(env = process.env) {
  const missing = Object.values(ORCA_ENV).filter((key) => !env[key])
  if (missing.length > 0) {
    const error = new Error(
      `dsh-orca: orchestration context missing: ${missing.join(', ')}. ` +
      'Launch this harness under an Orca dispatch with the DSH_ORCA_* variables set ' +
      '(see flinter-linear/skills/dsh-orca-worker).',
    )
    error.code = 'ORCA_CONTEXT_MISSING'
    throw error
  }
  return Object.freeze({
    runId: env[ORCA_ENV.runId],
    taskId: env[ORCA_ENV.taskId],
    dispatchId: env[ORCA_ENV.dispatchId],
    coordinator: env[ORCA_ENV.coordinator],
  })
}

/** Whether a complete orchestration context is present (non-throwing). */
export function hasOrcaContext(env = process.env) {
  return Object.values(ORCA_ENV).every((key) => Boolean(env[key]))
}
