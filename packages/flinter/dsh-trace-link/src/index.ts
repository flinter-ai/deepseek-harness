/**
 * Phase 2 native DSH -> FLINTER trace checkpoint contract.
 *
 * This package owns only a deterministic local checkpoint boundary. It does
 * not register a runtime service, assign scientific meaning, or write B2,
 * RDS, PikPak, investigation, observation, or TowerN state.
 */

import { createHash } from 'node:crypto'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

export const PHASE_STATUS = 'P2_CHECKPOINT_CONTRACT' as const
export const CHECKPOINT_SCHEMA_VERSION = 1 as const

export interface TraceCheckpointIdentity {
  readonly organizationId: string
  readonly tenantId: string
  readonly episodeId: string
  readonly runId: string
  readonly sessionId: string
  readonly producerId: string
}

export interface TraceCheckpointMetadata {
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
  readonly tokenUsage?: Readonly<Record<string, number>>
  readonly terminalStatus?: string
  readonly outcome?: string
  readonly evidenceRefs?: readonly string[]
  readonly capabilityAttemptRefs?: readonly string[]
  readonly producer?: string
}

export interface TraceCheckpointInput extends TraceCheckpointIdentity {
  readonly events: readonly SessionEvent[]
  readonly metadata?: TraceCheckpointMetadata
}

export interface TraceSegmentDescriptor extends TraceCheckpointIdentity {
  readonly schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION
  readonly segmentId: string
  readonly artifactId: string
  readonly storageRef: string
  readonly contentHash: string
  readonly codec: 'dsh-session-jsonl-v1'
  readonly compression: 'none'
  readonly byteLength: number
  readonly eventCount: number
  readonly seqStart: number
  readonly seqEnd: number
  readonly firstEventTime: number
  readonly lastEventTime: number
  readonly eventTypes: readonly string[]
  readonly redactionApplied: boolean
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
  readonly tokenUsage?: Readonly<Record<string, number>>
  readonly terminalStatus?: string
  readonly outcome?: string
  readonly evidenceRefs?: readonly string[]
  readonly capabilityAttemptRefs?: readonly string[]
  readonly producer?: string
}

export interface TraceCheckpointManifest extends TraceCheckpointIdentity {
  readonly schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION
  readonly manifestId: string
  readonly streamKey: string
  readonly segments: readonly TraceSegmentDescriptor[]
  readonly segmentCount: number
  readonly firstSeq: number
  readonly lastSeq: number
  readonly manifestHash: string
}

export interface TraceCheckpointReceipt {
  readonly status: typeof PHASE_STATUS
  readonly descriptor: TraceSegmentDescriptor
  readonly manifest: TraceCheckpointManifest
}

export interface ImmutableSegmentRecord {
  readonly key: string
  readonly bytes: string
  readonly contentHash: string
}

export interface ImmutableSegmentStore {
  putIfAbsent(key: string, bytes: string): Promise<{ created: boolean; contentHash: string }>
  get(key: string): Promise<ImmutableSegmentRecord | undefined>
}

export type TraceEventRedactor = (event: SessionEvent) => SessionEvent

export interface TraceCheckpointSink {
  checkpoint(input: TraceCheckpointInput): Promise<TraceCheckpointReceipt>
  finalize(identity: TraceCheckpointIdentity): Promise<TraceCheckpointManifest>
}

const REDACTED = '[REDACTED]'
const SENSITIVE_KEYS = new Set([
  'apikey',
  'secret',
  'password',
  'authorization',
  'accesstoken',
  'refreshtoken',
  'bearertoken',
  'credential',
  'credentials',
  'token',
])
const CONTAINER_SENSITIVE_KEYS = new Set(['credential', 'credentials'])

function isSafeReferenceKey(key: string): boolean {
  return /(?:env|ref|name)$/i.test(key)
}

function isSensitiveKey(key: string | undefined): boolean {
  return key !== undefined && SENSITIVE_KEYS.has(key.replace(/[_-]/g, '').toLowerCase())
}

function failJson(path: string, detail: string): never {
  throw new Error(`${path} is not JSON-serializable: ${detail}`)
}

function assertPlainObject(value: object, path: string): void {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    failJson(path, 'only plain objects are supported')
  }
}

function canonicalize(value: unknown, path = '$', ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) failJson(path, 'numbers must be finite')
    return value
  }
  if (value === undefined) failJson(path, 'undefined is not supported')
  if (typeof value !== 'object') failJson(path, `unsupported ${typeof value}`)

  if (ancestors.has(value)) failJson(path, 'cycles are not supported')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        failJson(path, 'only plain arrays are supported')
      }
      const keys = Reflect.ownKeys(value)
      for (const key of keys) {
        if (key === 'length') continue
        if (typeof key !== 'string' || !/^\d+$/.test(key) || Number(key) >= value.length) {
          failJson(path, 'arrays may not have extra or symbol properties')
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (descriptor?.get || descriptor?.set) failJson(`${path}[${key}]`, 'accessors are not supported')
      }
      const output: unknown[] = []
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (!descriptor || !('value' in descriptor)) failJson(`${path}[${index}]`, 'array holes are not supported')
        output.push(canonicalize(descriptor.value, `${path}[${index}]`, ancestors))
      }
      return output
    }

    assertPlainObject(value, path)
    const keys = Reflect.ownKeys(value)
    for (const key of keys) {
      if (typeof key !== 'string') failJson(path, 'symbol properties are not supported')
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || descriptor.get || descriptor.set) failJson(`${path}.${key}`, 'accessors are not supported')
      if (!descriptor.enumerable) failJson(`${path}.${key}`, 'non-enumerable properties are not supported')
    }
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const key of Object.keys(value).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      output[key] = canonicalize(descriptor?.value, `${path}.${key}`, ancestors)
    }
    return output
  } finally {
    ancestors.delete(value)
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function detachValue(value: unknown, seen = new Map<object, unknown>()): unknown {
  if (value === null || typeof value !== 'object') return value
  const existing = seen.get(value)
  if (existing !== undefined) return existing

  const output: object = Array.isArray(value)
    ? []
    : Object.create(Object.getPrototypeOf(value)) as object
  seen.set(value, output)
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined) continue
    if ('value' in descriptor) descriptor.value = detachValue(descriptor.value, seen)
    Object.defineProperty(output, key, descriptor)
  }
  return output
}

function hashBytes(bytes: string): string {
  return `sha256:${createHash('sha256').update(bytes, 'utf8').digest('hex')}`
}

function cloneRedacted(value: unknown, key: string | undefined, path: string, ancestors = new Set<object>()): unknown {
  if (value === undefined || value === null || typeof value !== 'object') {
    if (value === undefined) return value
    if (isSensitiveKey(key) && key !== undefined && !isSafeReferenceKey(key)
      && !CONTAINER_SENSITIVE_KEYS.has(key.toLowerCase())) {
      return REDACTED
    }
    return value
  }

  if (ancestors.has(value)) failJson(path, 'cycles are not supported')
  ancestors.add(value)
  try {
    if (isSensitiveKey(key) && key !== undefined && !isSafeReferenceKey(key)
      && !CONTAINER_SENSITIVE_KEYS.has(key.toLowerCase())) {
      return REDACTED
    }
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) failJson(path, 'only plain arrays are supported')
      const output: unknown[] = []
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (!descriptor || descriptor.get || descriptor.set || !('value' in descriptor)) {
          failJson(`${path}[${index}]`, 'array holes and accessors are not supported')
        }
        output.push(cloneRedacted(descriptor.value, undefined, `${path}[${index}]`, ancestors))
      }
      return output
    }

    assertPlainObject(value, path)
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const property of Reflect.ownKeys(value)) {
      if (typeof property !== 'string') failJson(path, 'symbol properties are not supported')
      const descriptor = Object.getOwnPropertyDescriptor(value, property)
      if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
        failJson(`${path}.${property}`, 'accessors and non-enumerable properties are not supported')
      }
      output[property] = cloneRedacted(descriptor.value, property, `${path}.${property}`, ancestors)
    }
    return output
  } finally {
    ancestors.delete(value)
  }
}

function assertNoRawSecrets(value: unknown, key: string | undefined, path = '$', ancestors = new Set<object>()): void {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string' && isSensitiveKey(key) && key !== undefined
      && !isSafeReferenceKey(key) && value !== REDACTED) {
      throw new Error(`${path} contains an unredacted credential value`)
    }
    return
  }
  if (ancestors.has(value)) failJson(path, 'cycles are not supported')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => assertNoRawSecrets(entry, undefined, `${path}[${index}]`, ancestors))
      return
    }
    for (const property of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, property)
      if (!descriptor || descriptor.get || descriptor.set) failJson(`${path}.${property}`, 'accessors are not supported')
      assertNoRawSecrets(descriptor.value, property, `${path}.${property}`, ancestors)
    }
  } finally {
    ancestors.delete(value)
  }
}

/** Apply the default fail-closed credential redaction policy to one event. */
export function redactTraceEvent(event: SessionEvent): SessionEvent {
  const redacted = cloneRedacted(event, undefined, '$')
  assertNoRawSecrets(redacted, undefined)
  canonicalize(redacted)
  return redacted as SessionEvent
}

function copyIdentity(input: TraceCheckpointIdentity): TraceCheckpointIdentity {
  return Object.freeze({
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    episodeId: input.episodeId,
    runId: input.runId,
    sessionId: input.sessionId,
    producerId: input.producerId,
  })
}

function sameIdentity(left: TraceCheckpointIdentity, right: TraceCheckpointIdentity): boolean {
  return left.organizationId === right.organizationId
    && left.tenantId === right.tenantId
    && left.episodeId === right.episodeId
    && left.runId === right.runId
    && left.sessionId === right.sessionId
    && left.producerId === right.producerId
}

function validateIdentity(input: TraceCheckpointIdentity): TraceCheckpointIdentity {
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`checkpoint identity ${key} must be a non-empty string`)
    }
  }
  return copyIdentity(input)
}

function safeMetadata(metadata: TraceCheckpointMetadata | undefined, tenantId: string): TraceCheckpointMetadata {
  if (metadata === undefined) return Object.freeze({})
  const redacted = cloneRedacted(metadata, undefined, '$.metadata')
  assertNoRawSecrets(redacted, undefined, '$.metadata')
  const normalized = canonicalize(redacted, '$.metadata')
  assertTenantReferences(normalized, tenantId, '$.metadata')
  return Object.freeze(normalized as TraceCheckpointMetadata)
}

function assertScopedReferences(
  references: readonly string[] | undefined,
  tenantId: string,
  label: string,
): void {
  if (references === undefined) return
  for (const reference of references) {
    if (typeof reference !== 'string') throw new Error(`${label} must contain only strings`)
    const scoped = /^(?:tenant[:/])([^:/]+)(?:[:/])/.exec(reference)
    if (scoped?.[1] !== undefined && scoped[1] !== tenantId) {
      throw new Error(`${label} contains a cross-tenant reference`)
    }
  }
}

function assertTenantReferences(
  value: unknown,
  tenantId: string,
  path = '$',
  ancestors = new Set<object>(),
): void {
  if (value === null || typeof value !== 'object') return
  if (ancestors.has(value)) failJson(path, 'cycles are not supported')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => assertTenantReferences(entry, tenantId, `${path}[${index}]`, ancestors))
      return
    }
    for (const [key, entry] of Object.entries(value)) {
      if ((key === 'tenantId' || key === 'tenant_id') && typeof entry === 'string' && entry !== tenantId) {
        throw new Error(`${path}.${key} contains a cross-tenant reference`)
      }
      assertTenantReferences(entry, tenantId, `${path}.${key}`, ancestors)
    }
  } finally {
    ancestors.delete(value)
  }
}

function deriveStreamKey(identity: TraceCheckpointIdentity): string {
  return `stream:${hashBytes(canonicalJson(identity))}`
}

function freezeDescriptor(descriptor: TraceSegmentDescriptor): TraceSegmentDescriptor {
  return Object.freeze({
    ...descriptor,
    eventTypes: Object.freeze([...descriptor.eventTypes]),
    ...(descriptor.tokenUsage === undefined ? {} : { tokenUsage: Object.freeze({ ...descriptor.tokenUsage }) }),
    ...(descriptor.evidenceRefs === undefined ? {} : { evidenceRefs: Object.freeze([...descriptor.evidenceRefs]) }),
    ...(descriptor.capabilityAttemptRefs === undefined
      ? {}
      : { capabilityAttemptRefs: Object.freeze([...descriptor.capabilityAttemptRefs]) }),
  })
}

function makeManifest(
  identity: TraceCheckpointIdentity,
  streamKey: string,
  segments: readonly TraceSegmentDescriptor[],
): TraceCheckpointManifest {
  const frozenSegments = Object.freeze([...segments])
  const body = {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    ...identity,
    streamKey,
    segments: frozenSegments,
  }
  const manifestHash = hashBytes(canonicalJson(body))
  const firstSegment = frozenSegments[0]
  const lastSegment = frozenSegments[frozenSegments.length - 1]
  if (firstSegment === undefined || lastSegment === undefined) {
    throw new Error('checkpoint manifest requires at least one segment')
  }
  return Object.freeze({
    ...identity,
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    manifestId: `manifest:${manifestHash}`,
    streamKey,
    segments: frozenSegments,
    segmentCount: frozenSegments.length,
    firstSeq: firstSegment.seqStart,
    lastSeq: lastSegment.seqEnd,
    manifestHash,
  })
}

function sameDescriptor(left: TraceSegmentDescriptor, right: TraceSegmentDescriptor): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

interface StreamState {
  readonly identity: TraceCheckpointIdentity
  readonly streamKey: string
  readonly segments: TraceSegmentDescriptor[]
  finalizedManifest?: TraceCheckpointManifest
}

/** Deterministic in-memory store used by the Phase 2 local gate. */
export class InMemoryImmutableSegmentStore implements ImmutableSegmentStore {
  private readonly records = new Map<string, ImmutableSegmentRecord>()

  async putIfAbsent(key: string, bytes: string): Promise<{ created: boolean; contentHash: string }> {
    const contentHash = hashBytes(bytes)
    const existing = this.records.get(key)
    if (existing !== undefined) {
      if (existing.bytes !== bytes) throw new Error(`immutable segment conflict: different content for ${key}`)
      return { created: false, contentHash: existing.contentHash }
    }
    this.records.set(key, Object.freeze({ key, bytes, contentHash }))
    return { created: true, contentHash }
  }

  async get(key: string): Promise<ImmutableSegmentRecord | undefined> {
    return this.records.get(key)
  }
}

/**
 * Losslessly checkpoints native SessionEvents into immutable local segments.
 * The store is intentionally injectable so a later Phase 4 adapter can own
 * B2 bytes and RDS metadata without changing this event/descriptor contract.
 */
export class LocalTraceCheckpointSink implements TraceCheckpointSink {
  private readonly streams = new Map<string, StreamState>()
  private readonly sessionIdentities = new Map<string, TraceCheckpointIdentity>()
  private readonly chains = new Map<string, Promise<void>>()

  constructor(
    private readonly store: ImmutableSegmentStore = new InMemoryImmutableSegmentStore(),
    private readonly redactor: TraceEventRedactor = redactTraceEvent,
  ) {}

  checkpoint(input: TraceCheckpointInput): Promise<TraceCheckpointReceipt> {
    const identity = validateIdentity({
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      episodeId: input.episodeId,
      runId: input.runId,
      sessionId: input.sessionId,
      producerId: input.producerId,
    })
    const knownIdentity = this.sessionIdentities.get(identity.sessionId)
    if (knownIdentity !== undefined && !sameIdentity(knownIdentity, identity)) {
      return Promise.reject(new Error('checkpoint identity mismatch for sessionId'))
    }
    if (knownIdentity === undefined) this.sessionIdentities.set(identity.sessionId, identity)

    const streamKey = deriveStreamKey(identity)
    const snapshot: TraceCheckpointInput = {
      ...identity,
      events: detachValue(input.events) as readonly SessionEvent[],
      ...(input.metadata === undefined ? {} : { metadata: detachValue(input.metadata) as TraceCheckpointMetadata }),
    }
    const prior = this.chains.get(streamKey) ?? Promise.resolve()
    const run = prior.then(() => this.checkpointCore(snapshot, identity, streamKey))
    this.chains.set(streamKey, run.then(() => undefined, () => undefined))
    return run
  }

  finalize(identityInput: TraceCheckpointIdentity): Promise<TraceCheckpointManifest> {
    const identity = validateIdentity(identityInput)
    const knownIdentity = this.sessionIdentities.get(identity.sessionId)
    if (knownIdentity !== undefined && !sameIdentity(knownIdentity, identity)) {
      return Promise.reject(new Error('checkpoint identity mismatch for sessionId'))
    }
    if (knownIdentity === undefined) this.sessionIdentities.set(identity.sessionId, identity)

    const streamKey = deriveStreamKey(identity)
    const prior = this.chains.get(streamKey) ?? Promise.resolve()
    const run = prior.then(() => this.finalizeCore(identity, streamKey))
    this.chains.set(streamKey, run.then(() => undefined, () => undefined))
    return run
  }

  private async checkpointCore(
    input: TraceCheckpointInput,
    identity: TraceCheckpointIdentity,
    streamKey: string,
  ): Promise<TraceCheckpointReceipt> {
    if (input.events.length === 0) throw new Error('checkpoint requires at least one event')
    const events = input.events
    const firstEvent = events[0]
    const lastEvent = events[events.length - 1]
    if (firstEvent === undefined || lastEvent === undefined) throw new Error('checkpoint requires at least one event')
    for (let index = 0; index < events.length; index++) {
      const current = events[index]
      if (current === undefined) throw new Error(`event ${index} is missing`)
      if (typeof current.type !== 'string' || current.type.length === 0) {
        throw new Error(`event ${index} must have a non-empty type`)
      }
      if (!Object.prototype.hasOwnProperty.call(current, 'data')) {
        throw new Error(`event ${index} is malformed: data is required`)
      }
      if (!Number.isSafeInteger(current.seq) || current.seq < 0) {
        throw new Error(`event ${index} sequence must be a safe non-negative integer`)
      }
      if (!Number.isFinite(current.time)) throw new Error(`event ${index} time must be finite`)
      if (index > 0) {
        const previous = events[index - 1]
        if (previous === undefined || current.seq !== previous.seq + 1) {
          throw new Error('checkpoint events must be contiguous')
        }
      }
    }

    const first = firstEvent.seq
    const last = lastEvent.seq
    const state = this.streams.get(streamKey)
    if (state === undefined && first !== 0) throw new Error('first checkpoint must start at sequence 0')
    if (state !== undefined) {
      if (!sameIdentity(state.identity, identity)) throw new Error('checkpoint identity mismatch')
      const exact = state.segments.find(segment => segment.seqStart === first && segment.seqEnd === last)
      if (exact === undefined && state.segments.some(segment => first <= segment.seqEnd && last >= segment.seqStart)) {
        throw new Error('checkpoint range overlap')
      }
      const lastSegment = state.segments[state.segments.length - 1]
      if (lastSegment === undefined) throw new Error('checkpoint stream has no segments')
      if (first !== lastSegment.seqEnd + 1) {
        if (exact === undefined) throw new Error('new checkpoint range must be contiguous')
      }
    }

    const redactedEvents = events.map((event, index) => {
      const redacted = this.redactor(event)
      assertNoRawSecrets(redacted, undefined)
      const normalized = canonicalize(redacted, `$.events[${index}]`)
      assertTenantReferences(normalized, identity.tenantId, `$.events[${index}]`)
      return normalized
    })
    const bytes = redactedEvents.map(event => `${JSON.stringify(event)}\n`).join('')
    const contentHash = hashBytes(bytes)
    const metadata = safeMetadata(input.metadata, identity.tenantId)
    assertScopedReferences(metadata.evidenceRefs, identity.tenantId, 'evidenceRefs')
    assertScopedReferences(metadata.capabilityAttemptRefs, identity.tenantId, 'capabilityAttemptRefs')
    const descriptor = freezeDescriptor({
      ...identity,
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      segmentId: `${streamKey}:${first}-${last}`,
      artifactId: `artifact:trace-segment:${contentHash}`,
      storageRef: `memory://trace-segment/${contentHash}`,
      contentHash,
      codec: 'dsh-session-jsonl-v1',
      compression: 'none',
      byteLength: Buffer.byteLength(bytes, 'utf8'),
      eventCount: events.length,
      seqStart: first,
      seqEnd: last,
      firstEventTime: firstEvent.time,
      lastEventTime: lastEvent.time,
      eventTypes: events.map(event => event.type),
      redactionApplied: true,
      ...(metadata.provider === undefined ? {} : { provider: metadata.provider }),
      ...(metadata.model === undefined ? {} : { model: metadata.model }),
      ...(metadata.reasoningEffort === undefined ? {} : { reasoningEffort: metadata.reasoningEffort }),
      ...(metadata.tokenUsage === undefined ? {} : { tokenUsage: metadata.tokenUsage }),
      ...(metadata.terminalStatus === undefined ? {} : { terminalStatus: metadata.terminalStatus }),
      ...(metadata.outcome === undefined ? {} : { outcome: metadata.outcome }),
      ...(metadata.evidenceRefs === undefined ? {} : { evidenceRefs: metadata.evidenceRefs }),
      ...(metadata.capabilityAttemptRefs === undefined ? {} : { capabilityAttemptRefs: metadata.capabilityAttemptRefs }),
      ...(metadata.producer === undefined ? {} : { producer: metadata.producer }),
    } as TraceSegmentDescriptor)

    const existingRange = state?.segments.find(segment => segment.seqStart === first && segment.seqEnd === last)
    if (existingRange !== undefined) {
      if (state === undefined) throw new Error('checkpoint range state is missing')
      if (!sameDescriptor(existingRange, descriptor)) throw new Error('checkpoint retry has different content or metadata')
      const stored = await this.store.putIfAbsent(descriptor.storageRef, bytes)
      if (stored.contentHash !== contentHash) throw new Error('immutable segment store hash mismatch')
      return this.receipt(identity, streamKey, state, existingRange)
    }
    if (state?.segments.some(segment => first <= segment.seqEnd && last >= segment.seqStart)) {
      throw new Error('checkpoint range overlap')
    }
    if (state?.finalizedManifest !== undefined) throw new Error('checkpoint stream is finalized')

    const stored = await this.store.putIfAbsent(descriptor.storageRef, bytes)
    if (stored.contentHash !== contentHash) throw new Error('immutable segment store hash mismatch')
    const nextState: StreamState = state === undefined
      ? { identity, streamKey, segments: [descriptor] }
      : { ...state, segments: [...state.segments, descriptor] }
    this.streams.set(streamKey, nextState)
    return this.receipt(identity, streamKey, nextState)
  }

  private async finalizeCore(
    identity: TraceCheckpointIdentity,
    streamKey: string,
  ): Promise<TraceCheckpointManifest> {
    const state = this.streams.get(streamKey)
    if (state === undefined) throw new Error('cannot finalize checkpoint stream without a segment')
    if (!sameIdentity(state.identity, identity)) throw new Error('checkpoint identity mismatch')
    if (state.finalizedManifest !== undefined) return state.finalizedManifest
    const manifest = makeManifest(identity, streamKey, state.segments)
    state.finalizedManifest = manifest
    return manifest
  }

  private receipt(
    identity: TraceCheckpointIdentity,
    streamKey: string,
    state: StreamState,
    descriptorOverride?: TraceSegmentDescriptor,
  ): TraceCheckpointReceipt {
    const descriptor = state.segments[state.segments.length - 1]
    if (descriptor === undefined) throw new Error('checkpoint stream has no segments')
    const manifest = state.finalizedManifest ?? makeManifest(identity, streamKey, state.segments)
    return Object.freeze({ status: PHASE_STATUS, descriptor: descriptorOverride ?? descriptor, manifest })
  }
}
