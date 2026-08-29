/** Scaffold-only literal task delivery contract for a future Runta adapter. */

export const SCAFFOLD_STATUS = 'SCAFFOLD_ONLY' as const

export interface ExecutorTask {
  readonly taskId: string
  readonly payload: unknown
}

export interface ExecutorAttempt {
  readonly attemptId: string
  readonly retryLineageId: string
  readonly fenced: boolean
}

export interface RuntaExecutorBoundary {
  readonly status: typeof SCAFFOLD_STATUS
  readonly submit: (task: ExecutorTask) => Promise<ExecutorAttempt>
  readonly cancel: (attemptId: string) => Promise<void>
}
