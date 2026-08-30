export interface DshTaskEnvelope {
  readonly taskId: string
  readonly sessionId: string
  readonly sessionRoot: string
  readonly argv: readonly string[]
}

export interface AttemptLineage {
  readonly taskId: string
  readonly sessionId: string
  readonly sessionRoot: string
  readonly attempt: number
  readonly leaseGeneration: number
  readonly previousAttempt?: number
}

export interface RuntaTaskDelivery {
  readonly envelope: DshTaskEnvelope
  readonly lineage: AttemptLineage
  readonly shell: false
}

function required(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\u0000')) throw new Error(`${label} is invalid`)
  return value
}

function nonNegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be non-negative`)
  return value
}

/** Build a literal, shell-disabled task delivery request. */
export function buildRuntaTaskDelivery(input: DshTaskEnvelope & AttemptLineage): RuntaTaskDelivery {
  required(input.taskId, 'taskId')
  required(input.sessionId, 'sessionId')
  required(input.sessionRoot, 'sessionRoot')
  if (!Array.isArray(input.argv) || input.argv.length === 0 || input.argv.some(value => typeof value !== 'string' || value.includes('\u0000'))) {
    throw new Error('argv must be a non-empty literal argument list')
  }
  nonNegative(input.attempt, 'attempt')
  nonNegative(input.leaseGeneration, 'leaseGeneration')
  if (input.previousAttempt !== undefined) nonNegative(input.previousAttempt, 'previousAttempt')
  if (input.previousAttempt !== undefined && input.previousAttempt >= input.attempt) throw new Error('attempt must advance retry lineage')
  return Object.freeze({
    envelope: Object.freeze({
      taskId: input.taskId,
      sessionId: input.sessionId,
      sessionRoot: input.sessionRoot,
      argv: Object.freeze([...input.argv]),
    }),
    lineage: Object.freeze({
      taskId: input.taskId,
      sessionId: input.sessionId,
      sessionRoot: input.sessionRoot,
      attempt: input.attempt,
      leaseGeneration: input.leaseGeneration,
      ...(input.previousAttempt === undefined ? {} : { previousAttempt: input.previousAttempt }),
    }),
    shell: false,
  })
}

/** Construct a replacement attempt while retaining the durable DSH session/root. */
export function replacementAttempt(previous: AttemptLineage, leaseGeneration: number): AttemptLineage {
  required(previous.taskId, 'taskId')
  required(previous.sessionId, 'sessionId')
  required(previous.sessionRoot, 'sessionRoot')
  nonNegative(previous.attempt, 'attempt')
  nonNegative(previous.leaseGeneration, 'leaseGeneration')
  nonNegative(leaseGeneration, 'leaseGeneration')
  if (leaseGeneration <= previous.leaseGeneration) throw new Error('replacement lease generation must advance')
  return Object.freeze({ ...previous, attempt: previous.attempt + 1, leaseGeneration, previousAttempt: previous.attempt })
}
