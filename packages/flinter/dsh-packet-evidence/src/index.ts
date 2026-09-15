/**
 * Independent DSH plugin for FLINTER's canonical packet evidence contract.
 *
 * The Search-R1 repository owns packet identity, evidence selection, hash
 * validation, and hard bounds. This package only invokes its configured
 * line-oriented service and exposes the same operations to a DSH runtime.
 * It is deliberately provider-neutral: Ark, Jacq, or another runner can load
 * this plugin without importing a Search-R1 worktree or duplicating evidence
 * semantics.
 *
 * @module @deepseek-ai/dsh-packet-evidence
 */

import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'

/** Protocol schema emitted by the Search-R1 packet registry service. */
export const PACKET_SERVICE_SCHEMA = 'packet-registry-service-v1' as const

/** Default limits used for one dynamic evidence request. */
export const DEFAULT_LIMITS = Object.freeze({
  maxTotalChars: 8_000,
  maxItemChars: 2_500,
  maxItems: 8,
})

/** Default child-process response bound; it is separate from evidence bounds. */
export const DEFAULT_MAX_RESPONSE_BYTES = 128_000

/** Default cooperative tool/process deadline. */
export const DEFAULT_TIMEOUT_MS = 30_000

/** External process configuration for the canonical packet service. */
export interface Config {
  /** Executable that serves packet-registry-service-v1 (for example python3). */
  command: string
  /** Arguments before the plugin appends `--registry-root <registryRoot>`. */
  args?: string[]
  /** Trusted canonical registry root understood by the configured service. */
  registryRoot: string
  /** Optional process working directory; it is never sent to the model. */
  cwd?: string
  /** Cooperative deadline for one service invocation. */
  timeoutMs?: number
  /** Maximum response bytes accepted from one service invocation. */
  maxResponseBytes?: number
  /** Prefix for model-facing tool names, default `flinter_`. */
  toolPrefix?: string
}

/** Schemastery configuration used when this package is loaded by DSH. */
export const Config: z<Config> = z.object({
  command: z.string().required(),
  args: z.array(z.string()).default([]),
  registryRoot: z.string().required(),
  cwd: z.string().default(''),
  timeoutMs: z.number().step(1).min(1).max(300_000).default(DEFAULT_TIMEOUT_MS),
  maxResponseBytes: z.number().step(1).min(256).max(10_000_000).default(DEFAULT_MAX_RESPONSE_BYTES),
  toolPrefix: z.string().pattern(/^[A-Za-z][A-Za-z0-9_]{0,20}$/).default('flinter_'),
})

/** Bounded evidence limits accepted by the canonical service. */
export interface EvidenceLimits {
  max_total_chars?: number
  max_item_chars?: number
  max_items?: number
}

/** Options for one evidence read; refs preserve caller order. */
export interface EvidenceGetOptions extends EvidenceLimits {
  refs?: string[]
}

/** Path-free service error returned by the canonical process boundary. */
export interface PacketServiceError {
  readonly code: string
  readonly message: string
}

/** Decoded service response. Bodies remain lossless JSON values. */
export interface PacketServiceResponse {
  readonly schema: string
  readonly id: JsonValue
  readonly ok: boolean
  readonly operation?: string
  readonly packet_id?: string
  readonly source_sha256?: string
  readonly requested_refs?: readonly string[]
  readonly limits?: EvidenceLimits
  readonly result?: JsonValue
  readonly error?: PacketServiceError
}

interface ResolvedConfig {
  readonly command: string
  readonly args: readonly string[]
  readonly registryRoot: string
  readonly cwd?: string
  readonly timeoutMs: number
  readonly maxResponseBytes: number
  readonly toolPrefix: string
}

/** Stable error type for service/process failures. */
export class PacketEvidenceError extends Error {
  readonly code: string

  constructor(message: string, code = 'PACKET_EVIDENCE_ERROR') {
    super(message)
    this.name = 'PacketEvidenceError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertNonEmptyString(value: string | undefined, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`packet-evidence: ${label} must be a non-empty string`)
  }
  return value
}

function assertPositiveInteger(value: number | undefined, label: string, minimum = 1): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`packet-evidence: ${label} must be an integer >= ${minimum}`)
  }
  return value
}

function resolveConfig(config: Config): ResolvedConfig {
  const command = assertNonEmptyString(config.command, 'command')
  const registryRoot = assertNonEmptyString(config.registryRoot, 'registryRoot')
  const args = [...config.args ?? []]
  if (args.some(arg => typeof arg !== 'string')) {
    throw new TypeError('packet-evidence: args must contain only strings')
  }
  if (args.includes('--registry-root')) {
    throw new TypeError('packet-evidence: args must not provide --registry-root')
  }
  const timeoutMs = assertPositiveInteger(config.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs') ?? DEFAULT_TIMEOUT_MS
  if (timeoutMs > 300_000) throw new TypeError('packet-evidence: timeoutMs must be <= 300000')
  const maxResponseBytes = assertPositiveInteger(
    config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    'maxResponseBytes',
  ) ?? DEFAULT_MAX_RESPONSE_BYTES
  if (maxResponseBytes < 256 || maxResponseBytes > 10_000_000) {
    throw new TypeError('packet-evidence: maxResponseBytes must be between 256 and 10000000')
  }
  const toolPrefix = config.toolPrefix ?? 'flinter_'
  if (!/^[A-Za-z][A-Za-z0-9_]{0,20}$/u.test(toolPrefix)) {
    throw new TypeError('packet-evidence: toolPrefix must be an identifier prefix')
  }
  const cwd = config.cwd?.trim() === '' ? undefined : config.cwd
  return { command, args, registryRoot, ...cwd === undefined ? {} : { cwd }, timeoutMs, maxResponseBytes, toolPrefix }
}

function assertPacketId(packetId: string): string {
  return assertNonEmptyString(packetId, 'packet_id')
}

function buildEvidenceParams(packetId: string, options: EvidenceGetOptions = {}): Record<string, unknown> {
  const params: Record<string, unknown> = { packet_id: assertPacketId(packetId) }
  if (options.refs !== undefined) {
    if (!Array.isArray(options.refs) || options.refs.some(ref => typeof ref !== 'string')) {
      throw new TypeError('packet-evidence: refs must be an array of strings')
    }
    // Preserve caller order and duplicates. Stable dedupe is a canonical-core
    // responsibility, so the service remains the only selection implementation.
    params.refs = [...options.refs]
  }
  const maxTotal = assertPositiveInteger(options.max_total_chars, 'max_total_chars', 2)
  const maxItem = assertPositiveInteger(options.max_item_chars, 'max_item_chars')
  const maxItems = assertPositiveInteger(options.max_items, 'max_items')
  if (maxTotal !== undefined) params.max_total_chars = maxTotal
  if (maxItem !== undefined) params.max_item_chars = maxItem
  if (maxItems !== undefined) params.max_items = maxItems
  return params
}

function jsonValue(value: PacketServiceResponse): JsonValue {
  return value as unknown as JsonValue
}

function abortError(): PacketEvidenceError {
  const error = new PacketEvidenceError('packet evidence request aborted', 'ABORTED')
  error.name = 'AbortError'
  return error
}

/**
 * Client for the Search-R1 packet registry process boundary.
 *
 * One short-lived child is used per request in this MVP. That keeps process
 * state isolated and makes the packet/registry seam easy to attach to DSH
 * runners without introducing a second persistent protocol or cache.
 */
export class PacketEvidenceClient {
  private readonly config: ResolvedConfig
  private sequence = 0

  constructor(config: Config) {
    this.config = resolveConfig(config)
  }

  /** Fetch metadata only; evidence bodies are not returned. */
  async packetDescribe(packetId: string, signal?: AbortSignal): Promise<PacketServiceResponse> {
    const response = await this.request('packet_describe', { packet_id: assertPacketId(packetId) }, signal)
    const accepted = this.assertSuccess(response, packetId)
    if (!isRecord(accepted.result) || accepted.result.packet_id !== packetId) {
      throw new PacketEvidenceError('packet service returned mismatched packet metadata', 'IDENTITY_MISMATCH')
    }
    return accepted
  }

  /** Fetch bounded evidence through the canonical service. */
  async evidenceGet(
    packetId: string,
    options: EvidenceGetOptions = {},
    signal?: AbortSignal,
  ): Promise<PacketServiceResponse> {
    const response = await this.request('evidence_get', buildEvidenceParams(packetId, options), signal)
    return this.assertSuccess(response, packetId)
  }

  /** Host-side compatibility operation for Jacq; it is not a model tool. */
  async materializeJacq(
    packetId: string,
    outputDir: string,
    limits: EvidenceLimits = {},
    signal?: AbortSignal,
  ): Promise<PacketServiceResponse> {
    const params: Record<string, unknown> = {
      packet_id: assertPacketId(packetId),
      output_dir: assertNonEmptyString(outputDir, 'output_dir'),
    }
    const maxTotal = assertPositiveInteger(limits.max_total_chars, 'max_total_chars', 2)
    const maxItem = assertPositiveInteger(limits.max_item_chars, 'max_item_chars')
    const maxItems = assertPositiveInteger(limits.max_items, 'max_items')
    if (maxTotal !== undefined) params.max_total_chars = maxTotal
    if (maxItem !== undefined) params.max_item_chars = maxItem
    if (maxItems !== undefined) params.max_items = maxItems
    const response = await this.request('materialize_jacq', params, signal)
    return this.assertSuccess(response, packetId)
  }

  private assertSuccess(response: PacketServiceResponse, packetId: string): PacketServiceResponse {
    if (response.packet_id !== undefined && response.packet_id !== packetId) {
      throw new PacketEvidenceError('packet service returned a mismatched packet_id', 'IDENTITY_MISMATCH')
    }
    if (!response.ok) {
      const detail = response.error
      throw new PacketEvidenceError(
        detail?.message ?? 'packet service rejected the request',
        detail?.code ?? 'SERVICE_REJECTED',
      )
    }
    return response
  }

  private async request(
    method: 'packet_describe' | 'evidence_get' | 'materialize_jacq',
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<PacketServiceResponse> {
    const request = JSON.stringify({
      id: `dsh-${++this.sequence}`,
      method,
      params,
    }) + '\n'
    return await new Promise<PacketServiceResponse>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams
      try {
        child = spawn(
          this.config.command,
          [...this.config.args, '--registry-root', this.config.registryRoot],
          {
            cwd: this.config.cwd,
            env: {
              PATH: process.env.PATH ?? '',
              ...process.env.LANG === undefined ? {} : { LANG: process.env.LANG },
              ...process.env.LC_ALL === undefined ? {} : { LC_ALL: process.env.LC_ALL },
            },
            shell: false,
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        )
      } catch (error) {
        reject(new PacketEvidenceError(`failed to start packet service: ${String(error)}`, 'SPAWN_FAILED'))
        return
      }

      let settled = false
      let output = Buffer.alloc(0)
      let timer: ReturnType<typeof setTimeout> | undefined
      const stop = () => {
        if (timer !== undefined) clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        if (!child.killed) child.kill('SIGTERM')
      }
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        stop()
        reject(error)
      }
      const finish = (response: PacketServiceResponse) => {
        if (settled) return
        settled = true
        stop()
        resolve(response)
      }
      const onAbort = () => fail(abortError())
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(() => fail(new PacketEvidenceError(
        `packet service timed out after ${this.config.timeoutMs}ms`,
        'TIMEOUT',
      )), this.config.timeoutMs)

      child.stdout.on('data', (chunk: Buffer | string) => {
        output = Buffer.concat([output, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
        if (output.byteLength > this.config.maxResponseBytes) {
          fail(new PacketEvidenceError('packet service response exceeds configured byte bound', 'RESPONSE_TOO_LARGE'))
          return
        }
        const newline = output.indexOf(0x0a)
        if (newline < 0) return
        const line = output.subarray(0, newline).toString('utf8').trim()
        if (line.length === 0) {
          fail(new PacketEvidenceError('packet service returned an empty response', 'INVALID_RESPONSE'))
          return
        }
        let decoded: unknown
        try {
          decoded = JSON.parse(line)
        } catch {
          fail(new PacketEvidenceError('packet service returned invalid JSON', 'INVALID_RESPONSE'))
          return
        }
        if (!isRecord(decoded) || decoded.schema !== PACKET_SERVICE_SCHEMA || typeof decoded.ok !== 'boolean') {
          fail(new PacketEvidenceError('packet service returned an incompatible response schema', 'INVALID_RESPONSE'))
          return
        }
        finish(decoded as unknown as PacketServiceResponse)
      })
      // Drain stderr without returning provider/process details to the model.
      child.stderr.on('data', () => undefined)
      child.once('error', error => fail(new PacketEvidenceError(
        `packet service process error: ${error.message}`,
        'PROCESS_ERROR',
      )))
      child.once('close', code => {
        if (!settled) fail(new PacketEvidenceError(
          `packet service exited before a response (code ${code ?? 'unknown'})`,
          'NO_RESPONSE',
        ))
      })
      child.stdin.end(request)
    })
  }
}

const JSON_OUTPUT = {
  schema: { type: 'json' as const },
  render: (_args: unknown, value: JsonValue): ContentBlock[] => [
    { type: 'text', text: JSON.stringify(value) },
  ],
}

const PROMPT_TEXT =
  'Packet evidence is accessed through the canonical FLINTER packet service. '
  + 'Use only an opaque `packet_id` and bounded evidence refs; do not request or infer filesystem paths. '
  + 'packet_describe returns metadata without evidence bodies. evidence_get returns recorded evidence only, '
  + 'and distinguishes valid empty results, bounded/truncated views, and service errors. '
  + 'Evidence is advisory for inspection; it does not establish semantic ground truth.'

/** Register the dynamic Ark/DSH evidence tools and shared model guidance. */
export function apply(ctx: Context, config: Config = {} as Config): void {
  const resolved = resolveConfig(config)
  const client = new PacketEvidenceClient(config)
  const describeName = `${resolved.toolPrefix}packet_describe`
  const evidenceName = `${resolved.toolPrefix}evidence_get`
  ctx.systemPrompt.section({
    name: 'tool:packet-evidence',
    order: FIRST_PARTY_SECTION_ORDER.TOOL_SESSION_QUERY + 5,
    text: PROMPT_TEXT,
  })

  ctx.tools.register(defineTool({
    name: describeName,
    description: 'Describe one canonical evidence packet by packet_id without reading evidence bodies.',
    parameters: {
      packet_id: { type: 'string', required: true, description: 'Opaque canonical packet identifier.' },
    },
    output: JSON_OUTPUT,
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => jsonValue(await client.packetDescribe(args.packet_id, exec.signal)),
  }))

  ctx.tools.register(defineTool({
    name: evidenceName,
    description:
      'Read bounded recorded evidence for an opaque packet_id. Preserve requested ref order; empty is valid, while unknown refs and service failures are errors.',
    parameters: {
      packet_id: { type: 'string', required: true, description: 'Opaque canonical packet identifier.' },
      refs: { type: 'array', items: { type: 'string' }, description: 'Optional evidence refs in priority order.' },
      max_total_chars: { type: 'integer', description: 'Maximum total canonical evidence characters; minimum 2.' },
      max_item_chars: { type: 'integer', description: 'Maximum characters in one evidence view.' },
      max_items: { type: 'integer', description: 'Maximum number of evidence views.' },
    },
    output: JSON_OUTPUT,
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => jsonValue(await client.evidenceGet(args.packet_id, {
      ...(args.refs === undefined ? {} : { refs: args.refs }),
      ...(args.max_total_chars === undefined ? {} : { max_total_chars: args.max_total_chars }),
      ...(args.max_item_chars === undefined ? {} : { max_item_chars: args.max_item_chars }),
      ...(args.max_items === undefined ? {} : { max_items: args.max_items }),
    }, exec.signal)),
  }))
}

/** Plugin object accepted directly by `ctx.plugin(PacketEvidence, config)`. */
const PacketEvidence = { name: 'packet-evidence', inject: ['tools', 'systemPrompt'], Config, apply }

export default PacketEvidence
