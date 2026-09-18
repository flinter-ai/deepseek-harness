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

/** Default grace period used by the DSH subprocess termination seam. */
export const DEFAULT_GRACE_MS = 1_000

/** Default tool deadline; the DSH timeout policy owns the actual deadline. */
export const DEFAULT_TIMEOUT_MS = 30_000

/** External process configuration for the canonical packet service. */
export interface Config {
  /** Executable that serves packet-registry-service-v1 (for example python3). */
  command: string
  /** Arguments before the capability appends `--registry-root <registryRoot>`. */
  args?: string[]
  /** Trusted canonical registry root understood by the configured service. */
  registryRoot: string
  /** Optional process working directory; it is never sent to the model. */
  cwd?: string
  /** DSH tool timeout; the standard timeout policy owns the deadline. */
  timeoutMs?: number
  /** Maximum response bytes accepted from one service invocation. */
  maxResponseBytes?: number
  /** Prefix for model-facing tool names, default `flinter_`. */
  toolPrefix?: string
}

/** Resolved configuration used by the DSH capability and its transport. */
export interface ResolvedConfig {
  readonly command: string
  readonly args: readonly string[]
  readonly registryRoot: string
  readonly cwd: string
  readonly timeoutMs: number
  readonly maxResponseBytes: number
  readonly toolPrefix: string
}

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

/** Methods supported by the Search-R1 packet service boundary. */
export type PacketServiceMethod = 'packet_describe' | 'evidence_get' | 'materialize_snapshot'

/** Transport seam; runtime ownership belongs to the caller's host. */
export interface PacketServiceTransport {
  request(
    method: PacketServiceMethod,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<PacketServiceResponse>
}

/** Stable error type for service/process failures. */
export class PacketEvidenceError extends Error {
  /** Stable machine-readable packet evidence error code. */
  readonly code: string

  constructor(message: string, code = 'PACKET_EVIDENCE_ERROR') {
    super(message)
    this.name = 'PacketEvidenceError'
    this.code = code
  }
}
