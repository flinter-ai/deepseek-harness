/**
 * Model-facing bounded macro-actions over the investigation-control domain:
 * `run_physical_assessment`, `finish_investigation`, and `stop_unknown`, plus
 * the authoritative state projection injected before each agent step.
 * @module @deepseek-ai/dsh-tool-agentic-control
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {
  InvestigationState,
  Lineage,
  PhysicalState,
} from '@deepseek-ai/dsh-agentic-control'

/** Cordis plugin name used by loader diagnostics and message attribution. */
export const name = 'tool-agentic-control'

/** Services the investigation tools require. */
export const inject = ['agents', 'investigations', 'tools', 'systemPrompt']

const INVESTIGATION_TOOLS: ReadonlySet<string> = new Set([
  'run_physical_assessment',
  'finish_investigation',
  'stop_unknown',
])

const ASSESS_DESCRIPTION =
  'Run one bounded physical assessment of the current investigation candidate through the '
  + 'deployment provider. The result assesses hand-observation validity, trace quality, HOI '
  + 'support, and object trace quality INDEPENDENTLY, and may attach or reject lineage; lineage '
  + 'is provider-authored and can never be set by tool arguments. Every call, failed or not, '
  + 'consumes one attempt of the investigation budget. Fails when no investigation is active, '
  + 'the investigation is already closed, or the budget is exhausted.'

const FINISH_DESCRIPTION =
  'Finish the current investigation. Allowed only while the investigation is active and every '
  + 'physical dimension has been assessed (evidence status satisfied). Terminal: a successful '
  + 'result concludes the current turn.'

const STOP_UNKNOWN_DESCRIPTION =
  'Stop the current investigation as unresolvable with the available evidence. Use when the '
  + 'candidate cannot be confirmed or rejected; explain the concrete reason. Terminal: a '
  + 'successful result concludes the current turn.'

const PHYSICAL_PROPERTIES = {
  handObservation: { type: 'string', required: true, enum: ['unknown', 'valid', 'invalid'] },
  traceQuality: { type: 'string', required: true, enum: ['unknown', 'reliable', 'degraded', 'absent'] },
  hoiSupport: { type: 'string', required: true, enum: ['unknown', 'positive', 'negative'] },
  objectTraceQuality: { type: 'string', required: true, enum: ['unknown', 'reliable', 'degraded', 'absent'] },
} as const

const ASSESS_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    physical: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: PHYSICAL_PROPERTIES,
    },
    lineage: { type: 'string', required: true, enum: ['unknown', 'attached', 'rejected'] },
    summary: { type: 'string', required: true },
    evidenceStatus: { type: 'string', required: true, enum: ['pending', 'partial', 'satisfied'] },
    revision: { type: 'integer', required: true },
    attemptsUsed: { type: 'integer', required: true },
    maxAttempts: { type: 'integer', required: true },
  },
} as const

const TERMINAL_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    phase: { type: 'string', required: true, enum: ['finished', 'stopped-unknown'] },
    revision: { type: 'integer', required: true },
    evidenceStatus: { type: 'string', required: true, enum: ['pending', 'partial', 'satisfied'] },
  },
} as const

/** Canonical output of `run_physical_assessment`. */
interface AssessmentToolValue {
  physical: PhysicalState
  lineage: Lineage
  summary: string
  evidenceStatus: InvestigationState['evidence']['currentStatus']
  revision: number
  attemptsUsed: number
  maxAttempts: number
}

/** Canonical output of the two terminal macro-actions. */
interface TerminalToolValue {
  phase: 'finished' | 'stopped-unknown'
  revision: number
  evidenceStatus: InvestigationState['evidence']['currentStatus']
}

/** Model policy section for the investigation macro-actions. */
const GUIDANCE =
  'An investigation is started by the harness, never by you; you operate the bounded '
  + 'macro-actions. Call run_physical_assessment to gather physical evidence for the current '
  + 'candidate: it reports hand-observation validity, trace quality, HOI support, and object '
  + 'trace quality independently, and only the provider may attach or reject lineage. Each '
  + 'assessment consumes one budgeted attempt, even when it fails. Call finish_investigation '
  + 'once every physical dimension is resolved; call stop_unknown with a concrete reason when '
  + 'the candidate cannot be resolved with the available evidence. Both are terminal and end '
  + 'the current turn.'

/** Resolve the executing agent, which the investigation tools require. */
function requireAgent(agent: Agent | undefined): Agent {
  if (agent === undefined) {
    throw new HarnessError('investigation tools require an executing agent', 'INVESTIGATION_TOOL_NO_AGENT')
  }
  return agent
}

/** Generic, args-only pending presentation shared by the investigation tools. */
function present(title: string, rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind: 'other', ...rawInput === undefined ? {} : { rawInput } }
}

/**
 * Render the authoritative state snapshot projected before an agent step.
 * @param state - current durable investigation state.
 * @returns the model-visible state snapshot text.
 */
export function renderInvestigationState(state: InvestigationState): string {
  const lines = [
    `Investigation state (revision ${state.revision}, phase ${state.phase}):`,
    `Candidate: ${state.candidate.id} (action family ${state.candidate.actionFamily}, window ${state.candidate.window}).`,
    `Evidence requirements (${state.evidence.currentStatus}): ${state.evidence.requirements.join('; ') || 'none'}.`,
    'Physical evidence: '
      + `hand observation ${state.physical.handObservation}; `
      + `trace quality ${state.physical.traceQuality}; `
      + `HOI support ${state.physical.hoiSupport}; `
      + `object trace quality ${state.physical.objectTraceQuality}.`,
    `Lineage: ${state.lineage} (provider-authored; tool arguments cannot change it).`,
    `Attempts: ${state.budget.usedAttempts} of ${state.budget.maxAttempts} used.`,
  ]
  if (state.phase === 'active') {
    lines.push(state.evidence.currentStatus === 'satisfied'
      ? 'All physical dimensions are resolved: call finish_investigation, or stop_unknown if the candidate cannot be resolved.'
      : 'Physical dimensions remain unknown: call run_physical_assessment, or stop_unknown if the candidate cannot be resolved.')
  }
  return lines.join('\n')
}

/**
 * Register the three investigation macro-action tools, the terminal-phase
 * guard, and the pre-step state projection for the lifetime of `ctx`.
 * @param ctx - plugin context; every contribution is disposed with it.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:agentic-control',
    order: 115,
    text: GUIDANCE,
  })

  // Last projected revision per session; state changes only through durable
  // commits, so a matching revision means the projection is already current.
  const projected = new WeakMap<Session, number>()

  ctx.on('agent/pre-step', async (
    { agent, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const state = ctx.investigations.get(agent)
    if (state === undefined || projected.get(agent.session) === state.revision) return decision
    projected.set(agent.session, state.revision)
    const text = renderInvestigationState(state)
    /* jscpd:ignore-start -- the snapshot-append return is the documented
       prepended pre-step listener idiom (see time-context); the differing
       projection logic above is the package-owned part. */
    return {
      kind: 'enter',
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name, text }] },
        }),
      ],
    }
    /* jscpd:ignore-end */
  }, { prepend: true })

  // Terminal within the step: once the investigation leaves the active phase,
  // no investigation tool may run again. Guards compose monotonically.
  ctx.tools.guard((exec) => {
    if (!INVESTIGATION_TOOLS.has(exec.name) || exec.agent === undefined) return undefined
    const state = ctx.investigations.get(exec.agent)
    if (state !== undefined && state.phase !== 'active') {
      return `investigation is ${state.phase}: \`${exec.name}\` is not executed`
    }
    return undefined
  })

  ctx.tools.register(defineTool({
    name: 'run_physical_assessment',
    description: ASSESS_DESCRIPTION,
    parameters: {},
    output: {
      schema: ASSESS_VALUE_SCHEMA,
      render: (_args: unknown, value: AssessmentToolValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    async execute(_args, exec) {
      const { state, result } = await ctx.investigations.runPhysicalAssessment(requireAgent(exec.agent))
      return {
        physical: state.physical,
        lineage: state.lineage,
        summary: result.summary,
        evidenceStatus: state.evidence.currentStatus,
        revision: state.revision,
        attemptsUsed: state.budget.usedAttempts,
        maxAttempts: state.budget.maxAttempts,
      }
    },
    presentCall: () => present('Run physical assessment'),
  }))

  ctx.tools.register(defineTool({
    name: 'finish_investigation',
    description: FINISH_DESCRIPTION,
    parameters: {},
    output: {
      schema: TERMINAL_VALUE_SCHEMA,
      render: (_args: unknown, value: TerminalToolValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    execute(_args, exec) {
      const state = ctx.investigations.finish(requireAgent(exec.agent))
      exec.concludeTurn()
      return Promise.resolve({
        phase: 'finished' as const,
        revision: state.revision,
        evidenceStatus: state.evidence.currentStatus,
      })
    },
    presentCall: () => present('Finish investigation'),
  }))

  ctx.tools.register(defineTool({
    name: 'stop_unknown',
    description: STOP_UNKNOWN_DESCRIPTION,
    parameters: {
      reason: {
        type: 'string',
        required: true,
        description: 'Concrete explanation of why the candidate cannot be resolved.',
      },
    },
    output: {
      schema: TERMINAL_VALUE_SCHEMA,
      render: (_args: unknown, value: TerminalToolValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    execute(args, exec) {
      const state = ctx.investigations.stopUnknown(requireAgent(exec.agent), args.reason)
      exec.concludeTurn()
      return Promise.resolve({
        phase: 'stopped-unknown' as const,
        revision: state.revision,
        evidenceStatus: state.evidence.currentStatus,
      })
    },
    presentCall: args => present('Stop investigation as unknown', args.reason),
  }))
}
