/**
 * Investigation-control capability: event-sourced typed `InvestigationState`
 * for one candidate per session, a provider-mediated physical-assessment
 * macro-action, and terminal transitions with authority guards. The durable
 * session log is the only state store; the process-local cache folds it.
 * @module @deepseek-ai/dsh-agentic-control
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  applyInvestigationChange,
  applyInvestigationEvent,
  decodeInvestigationChange,
  decodePhysical,
  deriveEvidenceStatus,
  emptyInvestigationFoldState,
} from './fold.ts'
import type { InvestigationFoldState } from './fold.ts'
import { INVESTIGATION_CHANGE_VERSION, InvestigationError } from './runtime.ts'
import type {
  AttemptRecord,
  InvestigationState,
  PhysicalAssessmentProvider,
  PhysicalAssessmentResult,
  StartInvestigationRequest,
} from './types.ts'
import type { InvestigationChangeMeta, InvestigationOperation } from './domain.ts'

export type * from './types.ts'
export type * from './domain.ts'
export { INVESTIGATION_CHANGE_VERSION, InvestigationError } from './runtime.ts'
export {
  applyInvestigationChange,
  applyInvestigationEvent,
  decodeInvestigationChange,
  decodePhysical,
  deriveEvidenceStatus,
  emptyInvestigationFoldState,
  foldInvestigations,
} from './fold.ts'
export type { InvestigationFoldState } from './fold.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    investigations: InvestigationService
  }
}

/** Deployment configuration for the investigation service. */
export interface Config {
  /** Default attempt cap for investigations that omit their own. */
  maxAttempts?: number
  /** Id of the registered physical-assessment provider. */
  provider?: string
}

/** Schemastery config for the investigation service. */
export const Config: z<Config> = z.object({
  maxAttempts: z.number().step(1).min(1).default(3),
  provider: z.string().default('stub'),
})

/** Process-local fold cache per session. */
interface InvestigationCache {
  readonly fold: InvestigationFoldState
  observedSeq: number
}

/** Validate a caller-visible positive safe-integer attempt cap. */
function resolveMaxAttempts(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new InvestigationError('maxAttempts must be a positive safe integer', 'INVESTIGATION_INVALID_REQUEST')
  }
  return value
}

/** Validate and normalize one required caller-visible label. */
function resolveLabel(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvestigationError(`${field} must be a non-empty string`, 'INVESTIGATION_INVALID_REQUEST')
  }
  return value.trim()
}

/** Validate a provider-produced assessment result at the provider boundary. */
function resolveAssessmentResult(providerId: string, result: PhysicalAssessmentResult): PhysicalAssessmentResult {
  try {
    decodePhysical(result.physical)
  } catch {
    throw new InvestigationError(
      `provider "${providerId}" returned malformed physical dimensions`,
      'INVESTIGATION_INVALID_RESULT',
    )
  }
  // Validated at the provider boundary: a misbehaving provider can return any
  // value where the static type promises a literal.
  const lineage: unknown = (result as { lineage?: unknown }).lineage
  if (typeof result.summary !== 'string' || result.summary.trim().length === 0
    || (lineage !== undefined && lineage !== 'attached' && lineage !== 'rejected')) {
    throw new InvestigationError(
      `provider "${providerId}" returned a malformed assessment result`,
      'INVESTIGATION_INVALID_RESULT',
    )
  }
  return result
}

/** Built-in stub provider: resolves every dimension and attaches lineage. */
const STUB_PROVIDER: PhysicalAssessmentProvider = {
  id: 'stub',
  provenance: 'stub',
  assess(state) {
    return {
      physical: {
        handObservation: 'valid',
        traceQuality: 'reliable',
        hoiSupport: 'positive',
        objectTraceQuality: 'reliable',
      },
      lineage: 'attached',
      summary: `Stub assessment of candidate ${state.candidate.id}: all physical dimensions resolved.`,
    }
  },
}

/**
 * Investigation service (`ctx.investigations`) backed exclusively by the
 * owning session log. One investigation per session; every mutation commits
 * a full-snapshot `investigation/change` event.
 */
export class InvestigationService extends Service {
  static inject = ['agents']

  static Config: z<Config> = Config

  private readonly maxAttempts: number
  private readonly providerName: string
  private readonly providers = new Map<string, PhysicalAssessmentProvider>()
  private readonly caches = new WeakMap<Session, InvestigationCache>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'investigations')
    this.maxAttempts = resolveMaxAttempts(config.maxAttempts ?? 3)
    const provider = config.provider ?? 'stub'
    if (typeof provider !== 'string' || provider.trim().length === 0) {
      throw new InvestigationError('provider must be a non-empty provider id', 'INVESTIGATION_UNKNOWN_PROVIDER')
    }
    this.providerName = provider
    this.providers.set(STUB_PROVIDER.id, STUB_PROVIDER)
  }

  /**
   * Register an additional physical-assessment provider. Registrations are
   * effects: the returned disposer removes the provider. The configured
   * provider is resolved lazily at the first assessment, so provider plugins
   * may load after this service.
   * @param provider - provider with a unique id and a provenance tag.
   * @returns disposer that unregisters the provider.
   */
  registerProvider(provider: PhysicalAssessmentProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new InvestigationError(
        `assessment provider "${provider.id}" is already registered`,
        'INVESTIGATION_INVALID_REQUEST',
      )
    }
    this.providers.set(provider.id, provider)
    return () => {
      this.providers.delete(provider.id)
    }
  }

  /**
   * Read the current investigation for one exact live agent.
   * @param agent - owning live agent.
   * @returns a detached state copy, or `undefined` when no investigation exists.
   * @throws {@link InvestigationError} when the agent is not the registry's live instance.
   */
  get(agent: Agent): InvestigationState | undefined {
    this.assertLive(agent)
    const cache = this.cache(agent.session)
    this.sync(agent.session, cache)
    return cache.fold.current === undefined ? undefined : structuredClone(cache.fold.current)
  }

  /**
   * Start the session's investigation. This is the privileged channel: the
   * harness creates investigations, the model never does.
   * @param agent - owning live agent.
   * @param request - candidate identity, evidence requirements, optional attempt cap.
   * @returns the created state at revision 1.
   * @throws {@link InvestigationError} `INVESTIGATION_EXISTS` when any investigation already exists.
   */
  start(agent: Agent, request: StartInvestigationRequest): InvestigationState {
    const cache = this.prepareMutation(agent)
    if (cache.fold.current !== undefined) {
      throw new InvestigationError(
        `investigation for candidate "${cache.fold.current.candidate.id}" already exists`,
        'INVESTIGATION_EXISTS',
      )
    }
    const state: InvestigationState = {
      revision: 1,
      candidate: {
        id: resolveLabel(request.candidateId, 'candidateId'),
        actionFamily: resolveLabel(request.actionFamily, 'actionFamily'),
        window: resolveLabel(request.window, 'window'),
      },
      evidence: {
        requirements: request.requirements.map(requirement => resolveLabel(requirement, 'requirement')),
        currentStatus: 'pending',
      },
      physical: {
        handObservation: 'unknown',
        traceQuality: 'unknown',
        hoiSupport: 'unknown',
        objectTraceQuality: 'unknown',
      },
      lineage: 'unknown',
      attempts: [],
      budget: {
        maxAttempts: resolveMaxAttempts(request.maxAttempts ?? this.maxAttempts),
        usedAttempts: 0,
      },
      phase: 'active',
    }
    return this.commit(agent, cache, 'start', state)
  }

  /**
   * Run one provider-mediated physical assessment, consuming one budget slot
   * whether the provider succeeds or fails. Lineage moves only through the
   * provider's typed result.
   * @param agent - owning live agent.
   * @returns the committed state and the provider's typed result.
   * @throws {@link InvestigationError} `INVESTIGATION_NOT_FOUND`, `INVESTIGATION_CLOSED`,
   *   `INVESTIGATION_BUDGET_EXHAUSTED`, or `INVESTIGATION_UNKNOWN_PROVIDER`; rethrows provider failures
   *   after committing a failed attempt.
   */
  async runPhysicalAssessment(agent: Agent): Promise<{ state: InvestigationState; result: PhysicalAssessmentResult }> {
    const cache = this.prepareMutation(agent)
    const current = this.expectActive(cache, 'run a physical assessment on')
    if (current.budget.usedAttempts >= current.budget.maxAttempts) {
      throw new InvestigationError(
        `investigation exhausted ${current.budget.maxAttempts} assessment attempts`,
        'INVESTIGATION_BUDGET_EXHAUSTED',
      )
    }
    const provider = this.providers.get(this.providerName)
    if (provider === undefined) {
      throw new InvestigationError(
        `no assessment provider registered as "${this.providerName}"`,
        'INVESTIGATION_UNKNOWN_PROVIDER',
      )
    }
    let result: PhysicalAssessmentResult
    try {
      result = resolveAssessmentResult(provider.id, await provider.assess(current))
    } catch (error: unknown) {
      if (error instanceof InvestigationError) throw error
      const reason = error instanceof Error ? error.message : String(error)
      this.commitAttempt(agent, cache, current, provider, 'failed', reason)
      throw error
    }
    const attempt = this.attempt(provider, 'completed')
    const state: InvestigationState = {
      ...current,
      revision: current.revision + 1,
      evidence: {
        requirements: current.evidence.requirements,
        currentStatus: deriveEvidenceStatus(result.physical),
      },
      physical: result.physical,
      lineage: result.lineage ?? current.lineage,
      attempts: [...current.attempts, attempt],
      budget: { maxAttempts: current.budget.maxAttempts, usedAttempts: current.budget.usedAttempts + 1 },
    }
    return { state: this.commit(agent, cache, 'assess', state), result }
  }

  /**
   * Finish an active investigation whose evidence requirements are satisfied.
   * @param agent - owning live agent.
   * @returns the terminal state.
   * @throws {@link InvestigationError} `INVESTIGATION_NOT_FINISHABLE` while any
   *   physical dimension remains unknown.
   */
  finish(agent: Agent): InvestigationState {
    const cache = this.prepareMutation(agent)
    const current = this.expectActive(cache, 'finish')
    if (current.evidence.currentStatus !== 'satisfied') {
      throw new InvestigationError(
        `investigation evidence is ${current.evidence.currentStatus}; all physical dimensions must be assessed before finishing`,
        'INVESTIGATION_NOT_FINISHABLE',
      )
    }
    return this.commit(agent, cache, 'finish', {
      ...current,
      revision: current.revision + 1,
      phase: 'finished',
    })
  }

  /**
   * Stop an active investigation that cannot be resolved with the available evidence.
   * @param agent - owning live agent.
   * @param reason - concrete non-empty explanation recorded durably.
   * @returns the terminal state.
   */
  stopUnknown(agent: Agent, reason: string): InvestigationState {
    const cache = this.prepareMutation(agent)
    const current = this.expectActive(cache, 'stop as unknown')
    return this.commit(
      agent,
      cache,
      'stop-unknown',
      { ...current, revision: current.revision + 1, phase: 'stopped-unknown' },
      resolveLabel(reason, 'reason'),
    )
  }

  /** Resolve and validate the cache used by a mutation. */
  private prepareMutation(agent: Agent): InvestigationCache {
    this.assertLive(agent)
    const cache = this.cache(agent.session)
    this.sync(agent.session, cache)
    return cache
  }

  /** Require a current active investigation for one operation. */
  private expectActive(cache: InvestigationCache, operation: string): InvestigationState {
    const current = cache.fold.current
    if (current === undefined) {
      throw new InvestigationError(`no investigation to ${operation}`, 'INVESTIGATION_NOT_FOUND')
    }
    if (current.phase !== 'active') {
      throw new InvestigationError(
        `cannot ${operation} an investigation in phase "${current.phase}"`,
        'INVESTIGATION_CLOSED',
      )
    }
    return current
  }

  /** Enforce exact live-agent identity rather than trusting a matching id. */
  private assertLive(agent: Agent): void {
    if (this.ctx.agents.get(agent.id) !== agent) {
      throw new InvestigationError(`agent "${agent.id}" is not live in this registry`, 'INVESTIGATION_AGENT_NOT_LIVE')
    }
  }

  /** Return the per-session cache, folding the log once. */
  private cache(session: Session): InvestigationCache {
    let cache = this.caches.get(session)
    if (cache !== undefined) return cache
    const fold = emptyInvestigationFoldState()
    for (const event of session.events) applyInvestigationEvent(fold, event)
    cache = { fold, observedSeq: session.events.length }
    this.caches.set(session, cache)
    return cache
  }

  /** Incrementally observe durable events appended after the cache was seeded. */
  private sync(session: Session, cache: InvestigationCache): void {
    for (const event of session.events.slice(cache.observedSeq)) {
      applyInvestigationEvent(cache.fold, event)
      cache.observedSeq += 1
    }
  }

  /** Build one attempt record stamped now. */
  private attempt(provider: PhysicalAssessmentProvider, outcome: AttemptRecord['outcome'], reason?: string): AttemptRecord {
    return {
      action: 'run_physical_assessment',
      provider: provider.id,
      outcome,
      provenance: provider.provenance,
      at: Date.now(),
      ...reason === undefined ? {} : { reason },
    }
  }

  /** Commit a failed attempt that still consumes one budget slot. */
  private commitAttempt(
    agent: Agent,
    cache: InvestigationCache,
    current: InvestigationState,
    provider: PhysicalAssessmentProvider,
    outcome: 'failed',
    reason: string,
  ): void {
    this.commit(agent, cache, 'assess-failed', {
      ...current,
      revision: current.revision + 1,
      attempts: [...current.attempts, this.attempt(provider, outcome, reason)],
      budget: { maxAttempts: current.budget.maxAttempts, usedAttempts: current.budget.usedAttempts + 1 },
    }, reason)
  }

  /** Commit one full-snapshot mutation into the session log and the fold cache. */
  private commit(
    agent: Agent,
    cache: InvestigationCache,
    operation: InvestigationOperation,
    state: InvestigationState,
    reason?: string,
  ): InvestigationState {
    const change: InvestigationChangeMeta = {
      kind: 'investigation/change',
      version: INVESTIGATION_CHANGE_VERSION,
      operation,
      state,
      ...reason === undefined ? {} : { reason },
      at: Date.now(),
    }
    // Publish only at the commit point: run the strict replay fold on a
    // throwaway accumulator first, so a violating change can never reach the
    // durable log (a malformed provider result is rejected before append).
    const decoded = decodeInvestigationChange(change)
    /* v8 ignore next -- the change literal above always declares its own kind. */
    if (decoded === undefined) throw new Error('investigation commit produced an unidentifiable change')
    applyInvestigationChange({ current: cache.fold.current }, decoded)
    agent.session.append('investigation/change', change)
    this.sync(agent.session, cache)
    return structuredClone(state)
  }
}

export default InvestigationService
