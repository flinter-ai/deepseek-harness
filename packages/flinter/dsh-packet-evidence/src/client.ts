import type { PacketServiceResponse, PacketServiceTransport, EvidenceGetOptions, EvidenceLimits } from './types.ts'
import { PacketEvidenceError } from './types.ts'

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

/** Protocol client; transport/runtime concerns are injected by the host. */
export class PacketEvidenceClient {
  constructor(private readonly transport: PacketServiceTransport) {}

  /** Fetch metadata only; evidence bodies are not returned. */
  async packetDescribe(packetId: string, signal?: AbortSignal): Promise<PacketServiceResponse> {
    const response = await this.transport.request(
      'packet_describe',
      { packet_id: assertPacketId(packetId) },
      signal,
    )
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
    const response = await this.transport.request('evidence_get', buildEvidenceParams(packetId, options), signal)
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
    const response = await this.transport.request('materialize_snapshot', params, signal)
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
}
