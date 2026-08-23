/**
 * @flinter/dsh-pes query runner — bounded tool semantics over the engine seam.
 *
 * Each of the four registered tools maps to exactly one engine mode
 * (search / similar / counterfactual / zoom) and returns a structured result
 * envelope. Schema-valid but semantically invalid arguments (empty query, n
 * out of bounds, t_end < t_start, no state fields, unbounded state arrays)
 * are rejected HERE as a structured `malformed-input` result — the tools
 * registry already rejects JSON-schema violations before `execute` runs, and
 * the schema DSL's supported subset (types/enum/oneOf only) keeps numeric
 * bounds in this module. Everything the engine can fail with (per-request
 * rejection, timeout, nonzero exit, protocol violation, unstartable command)
 * is preserved as a structured error result with a stable `error.kind`.
 *
 * Events carry their per-event provenance (`provenance`, `verification`,
 * `outcome_source`) through unchanged, and an engine abstention surfaces as
 * `status: 'abstained'`, never as an error. Artifact references: events
 * reference their source scan artifacts via `source_path`; when
 * `artifactsRoot` is configured every returned event's `source_path` must
 * resolve to an existing file under that root and a missing reference fails
 * the WHOLE call loud as `artifact-reference-missing` (fail-closed, bounded
 * to the returned events). Without `artifactsRoot`, reference verification is
 * skipped and `artifact_verification` reports `unconfigured`.
 */

import { existsSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { ENGINE_PROTOCOL, resolveEngineArgv, spawnEngineQuery } from './engine.js'

export const SEARCH_EVENTS = 'search_events'
export const FIND_SIMILAR_STATES = 'find_similar_states'
export const FIND_COUNTERFACTUALS = 'find_counterfactuals'
export const ZOOM = 'zoom'
export const RESULT_SCHEMA_VERSION = 'dsh-pes-result.v1'
export const DEFAULT_RESULT_N = 3
export const MAX_RESULT_N = 50
export const MAX_STATE_ITEMS = 32
export const MAX_TEXT_LENGTH = 1024

/** Tool name -> engine mode (1:1); error results always carry the tool's mode. */
const TOOL_MODES = {
  [SEARCH_EVENTS]: 'search',
  [FIND_SIMILAR_STATES]: 'similar',
  [FIND_COUNTERFACTUALS]: 'counterfactual',
  [ZOOM]: 'zoom',
}

export const searchEventsInput = {
  query: {
    type: 'string', required: true,
    description: 'Natural-language query over all indexed events (non-empty, at most 1024 chars)',
  },
  n: resultCountSpec(),
}

export const findSimilarStatesInput = {
  holding: stateRelationSpec('Objects held in the pre-state; at least one of holding/on_surface must be non-empty'),
  on_surface: stateRelationSpec('Objects on the surface in the pre-state; at least one of holding/on_surface must be non-empty'),
  n: resultCountSpec(),
}

export const findCounterfactualsInput = {
  outcome: {
    type: 'string', required: true,
    description: 'Episode outcome to EXCLUDE: results are events from state-similar episodes with a DIFFERENT outcome (non-empty, at most 1024 chars)',
  },
  holding: stateRelationSpec('Objects held in the start state; at least one of holding/on_surface must be non-empty'),
  on_surface: stateRelationSpec('Objects on the surface in the start state; at least one of holding/on_surface must be non-empty'),
  n: resultCountSpec(),
}

export const zoomInput = {
  episode: {
    type: 'string', required: true,
    description: 'Episode id to zoom into (non-empty, at most 1024 chars)',
  },
  t_start: {
    type: 'integer', required: true,
    description: 'Window start frame (non-negative integer)',
  },
  t_end: {
    type: 'integer', required: true,
    description: 'Window end frame (integer, >= t_start)',
  },
}

function stateRelationSpec(description) {
  return {
    type: 'array', description,
    items: { type: 'string' },
  }
}

function resultCountSpec() {
  return {
    type: 'integer', default: DEFAULT_RESULT_N,
    description: `Result count (default ${DEFAULT_RESULT_N}; integer in [1, ${MAX_RESULT_N}]; clamped to the corpus)`,
  }
}

/** One returned event pass-through: the canonical PhysicalEvent JSON shape. */
const eventItemSpec = {
  type: 'object', additionalProperties: true,
  description: 'A canonical PhysicalEvent (event_id, episode_id, t_start, t_end, state_before/after, transition_type, delta_magnitude, outcome, outcome_source, family_hint, provenance, verification, source_path)',
}

/** Provenance envelope: plugin + engine protocol + optional immutable pin. */
const provenanceSpec = {
  type: 'object', required: true, additionalProperties: false,
  properties: {
    plugin: { type: 'string', required: true, description: 'Producing plugin package' },
    engine: { type: 'string', required: true, description: 'Engine CLI identity' },
    engine_protocol: { type: 'string', required: true, description: 'Engine wire protocol version' },
    engine_pin: { type: 'string', description: 'Immutable producer SHA when a deployment pins it; absent means NOT pinned (integration-gate work)' },
  },
}

/** Structured error taxonomy preserved on the tool result. */
const engineErrorSpec = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: {
      type: 'string', required: true,
      enum: [
        'malformed-input',
        'engine-timeout',
        'engine-nonzero-exit',
        'engine-malformed-response',
        'engine-unavailable',
        'artifact-reference-missing',
      ],
      description: 'Stable failure class of the structured result',
    },
    message: { type: 'string', required: true, description: 'Human-readable failure detail' },
    engine_error: { type: 'string', description: 'Engine-reported per-request error text, when present' },
    line: { type: 'integer', description: 'Engine-reported stdin line of a malformed request, when present' },
    exit_code: { type: 'integer', description: 'Engine process exit code, when present' },
    stderr: { type: 'string', description: 'Engine stderr tail, when present and bounded' },
    missing: {
      type: 'array',
      description: 'Missing artifact references (event_id + source_path), when kind is artifact-reference-missing',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          event_id: { type: 'string', required: true, description: 'Event whose artifact reference is missing' },
          source_path: { type: 'string', required: true, description: 'The unresolved artifact reference' },
        },
      },
    },
    command: {
      type: 'array',
      description: 'Resolved engine argv, when the failure involves the command',
      items: { type: 'string' },
    },
  },
}

const baseResultProperties = {
  tool: { type: 'string', required: true, description: 'The invoked tool name' },
  schema_version: { type: 'string', required: true, description: 'Result envelope schema version' },
  status: {
    type: 'string', required: true,
    enum: ['completed', 'abstained', 'error'],
    description: 'completed: engine returned events; abstained: engine honestly returned none; error: structured failure',
  },
  mode: { type: 'string', required: true, description: 'Engine query mode' },
  count: { type: 'integer', required: true, description: 'Number of returned events (bounded)' },
  bounded: { type: 'boolean', required: true, description: 'true: output is clamped to the requested n / corpus' },
  event_ids: { type: 'array', required: true, items: { type: 'string' }, description: 'Returned event ids, bounded' },
  events: { type: 'array', required: true, items: eventItemSpec, description: 'Returned canonical events, bounded' },
  abstained: { type: 'boolean', required: true, description: 'Engine honest abstention marker' },
  artifact_verification: {
    type: 'string', required: true,
    enum: ['verified', 'unconfigured'],
    description: 'verified: every source_path resolved under artifactsRoot; unconfigured: no artifactsRoot set or no events returned to verify',
  },
  provenance: provenanceSpec,
  query: { type: 'string', description: 'search_events echo: the query text' },
  state: {
    type: 'object', description: 'similar/counterfactual echo: the matched start state',
    additionalProperties: false,
    properties: {
      holding: { type: 'array', items: { type: 'string' } },
      on_surface: { type: 'array', items: { type: 'string' } },
    },
  },
  outcome: { type: 'string', description: 'counterfactual echo: the excluded outcome' },
  episode: { type: 'string', description: 'zoom echo: the episode id' },
  t_start: { type: 'integer', description: 'zoom echo: window start frame' },
  t_end: { type: 'integer', description: 'zoom echo: window end frame' },
  n: { type: 'integer', description: 'echo: the requested/clamped result count' },
  error: engineErrorSpec,
}

/**
 * Result schema for one tool: the shared bounded envelope narrowed to the
 * tool's name and engine mode.
 * @param tool - the registered tool name.
 * @param mode - the engine query mode the tool maps to.
 */
export function dshPesResultFor(tool, mode) {
  return {
    type: 'object', additionalProperties: false,
    properties: {
      ...baseResultProperties,
      tool: { ...baseResultProperties.tool, enum: [tool] },
      mode: { ...baseResultProperties.mode, enum: [mode] },
    },
  }
}

/**
 * Build the engine request for one tool invocation, applying the plugin's
 * semantic (schema-inexpressible) validation. Bounds live here: the schema
 * DSL subset has no numeric/string length keywords.
 * @returns `{ mode, request }` or `{ problem }` for a malformed input.
 */
export function buildEngineRequest(tool, args) {
  const count = normalizeCount(args.n)
  if (count.problem !== undefined) return { problem: count.problem }
  const n = count.n
  switch (tool) {
    case SEARCH_EVENTS: {
      const text = scopeText(args.query, 'search_events query')
      if (text.problem !== undefined) return { problem: text.problem }
      return { mode: 'search', request: { mode: 'search', query: text.value, n } }
    }
    case FIND_SIMILAR_STATES: {
      const state = normalizeState(args)
      if (state.problem !== undefined) return { problem: state.problem }
      return { mode: 'similar', request: { mode: 'similar', holding: state.holding, on_surface: state.on_surface, n } }
    }
    case FIND_COUNTERFACTUALS: {
      const outcome = scopeText(args.outcome, 'find_counterfactuals outcome')
      if (outcome.problem !== undefined) return { problem: outcome.problem }
      const state = normalizeState(args)
      if (state.problem !== undefined) return { problem: state.problem }
      return { mode: 'counterfactual', request: { mode: 'counterfactual', holding: state.holding, on_surface: state.on_surface, outcome: outcome.value, n } }
    }
    case ZOOM: {
      const episode = scopeText(args.episode, 'zoom episode')
      if (episode.problem !== undefined) return { problem: episode.problem }
      const { t_start, t_end } = args
      if (!Number.isInteger(t_start) || !Number.isInteger(t_end)) {
        return { problem: 'zoom requires integer t_start and t_end' }
      }
      if (t_start < 0 || t_end < t_start) {
        return { problem: 'zoom requires 0 <= t_start <= t_end' }
      }
      return { mode: 'zoom', request: { mode: 'zoom', episode: episode.value, t_start, t_end } }
    }
    default:
      return { problem: `unhandled tool ${String(tool)}` }
  }
}

function normalizeCount(value) {
  if (value === undefined || value === null) return { n: DEFAULT_RESULT_N }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_RESULT_N) {
    return { problem: `n must be an integer in [1, ${MAX_RESULT_N}], got ${JSON.stringify(value)}` }
  }
  return { n: value }
}

function scopeText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    return { problem: `${field} must be a non-empty string` }
  }
  const trimmed = value.trim()
  if (trimmed.length > MAX_TEXT_LENGTH) {
    return { problem: `${field} exceeds ${MAX_TEXT_LENGTH} characters` }
  }
  return { value: trimmed }
}

function normalizeState(args) {
  const holdingResult = cleanRelation(args.holding, 'holding')
  const surfaceResult = cleanRelation(args.on_surface, 'on_surface')
  if (holdingResult.problem !== undefined) return { problem: holdingResult.problem }
  if (surfaceResult.problem !== undefined) return { problem: surfaceResult.problem }
  const { value: holding } = holdingResult
  const { value: on_surface } = surfaceResult
  if (holding.length === 0 && on_surface.length === 0) {
    return { problem: 'at least one of holding / on_surface must be non-empty' }
  }
  return { holding, on_surface }
}

function cleanRelation(value, field) {
  if (value === undefined || value === null) return { value: [] }
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    return { problem: `${field} must be an array of strings` }
  }
  const unique = [...new Set(value.map(item => item.trim()).filter(item => item !== ''))].sort()
  if (unique.length > MAX_STATE_ITEMS) {
    return { problem: `${field} limited to ${MAX_STATE_ITEMS} items` }
  }
  return { value: unique }
}

/**
 * Verify every returned event's `source_path` resolves under the configured
 * artifacts root. Without a root the check is skipped (unconfigured), never
 * guessed. Only canonical events (string `event_id` + string `source_path`)
 * are verified.
 * @returns `{ unconfigured, missing }` where missing is a bounded list of
 *   `{ event_id, source_path }` refs that do not exist on disk.
 */
export function verifyArtifactReferences(events, artifactsRoot) {
  if (artifactsRoot === undefined || artifactsRoot === null || artifactsRoot === '') {
    return { unconfigured: true, missing: [] }
  }
  const missing = []
  const root = resolve(artifactsRoot)
  for (const event of events) {
    if (typeof event !== 'object' || event === null) continue
    if (typeof event.event_id !== 'string' || typeof event.source_path !== 'string' || event.source_path === '') {
      continue
    }
    const candidate = resolve(root, event.source_path)
    const relativePath = relative(root, candidate)
    const outsideRoot = relativePath === '..'
      || relativePath.startsWith(`..${sep}`)
      || isAbsolute(relativePath)
    if (outsideRoot || !existsSync(candidate)) {
      missing.push({ event_id: event.event_id, source_path: event.source_path })
    }
  }
  return { unconfigured: false, missing }
}

/**
 * Run one tool invocation end to end: validate semantically, spawn the engine
 * through the configured seam, verify artifact references, and wrap the
 * outcome in the structured result envelope. Never throws for engine-side
 * failures — they settle as `status: 'error'` results.
 *
 * @param tool - the invoked tool name.
 * @param args - the validated (schema-level) tool arguments.
 * @param config - resolved engine config from resolveEngineConfig.
 * @returns the bounded structured result object.
 */
export async function runQuery(tool, args, config) {
  const envelopeBase = {
    tool,
    schema_version: RESULT_SCHEMA_VERSION,
    bounded: true,
    provenance: {
      plugin: '@flinter/dsh-pes',
      engine: 'event_index.query',
      engine_protocol: ENGINE_PROTOCOL,
      ...(config.enginePin !== undefined && config.enginePin !== null ? { engine_pin: config.enginePin } : {}),
    },
  }

  const built = buildEngineRequest(tool, args)
  if (built.problem !== undefined) {
    return errorEnvelope(envelopeBase, tool, { kind: 'malformed-input', message: built.problem })
  }

  const eventsPath = config.eventsPath
  if (eventsPath === undefined || eventsPath === '') {
    return errorEnvelope(envelopeBase, tool, {
      kind: 'engine-unavailable',
      message: 'no events index configured: set config.events or $PES_EVENTS_ENRICHED_JSONL',
    })
  }

  const outcome = await spawnEngineQuery(
    resolveEngineArgv(config.command, eventsPath),
    built.request,
    { eventsPath, timeoutMs: config.timeoutMs, env: process.env },
  )
  if (!outcome.ok) {
    return errorEnvelope(envelopeBase, tool, outcome.error, config.command)
  }

  const response = outcome.response
  const { event_ids, events, abstained } = response
  const verification = verifyArtifactReferences(events, config.artifactsRoot)
  if (verification.missing.length > 0) {
    return errorEnvelope(envelopeBase, tool, {
      kind: 'artifact-reference-missing',
      message: `${verification.missing.length} returned event(s) reference missing artifacts under ${config.artifactsRoot}`,
      missing: verification.missing.slice(0, MAX_RESULT_N),
    }, config.command)
  }

  const echo = pickEchoFields(built.mode, response)
  return {
    ...envelopeBase,
    status: abstained ? 'abstained' : 'completed',
    mode: built.mode,
    count: event_ids.length,
    event_ids,
    events,
    abstained,
    artifact_verification: verification.unconfigured ? 'unconfigured' : 'verified',
    ...echo,
  }
}

function errorEnvelope(base, tool, error, command) {
  return {
    ...base,
    status: 'error',
    mode: TOOL_MODES[tool],
    count: 0,
    event_ids: [],
    events: [],
    abstained: false,
    artifact_verification: 'unconfigured',
    error: command === undefined ? error : { ...error, command },
  }
}

function pickEchoFields(mode, response) {
  switch (mode) {
    case 'search':
      return { query: response.query, n: response.n }
    case 'similar':
      return { state: response.state, n: response.n }
    case 'counterfactual':
      return { state: response.state, outcome: response.outcome, n: response.n }
    case 'zoom':
      return { episode: response.episode, t_start: response.t_start, t_end: response.t_end }
    default:
      return {}
  }
}
