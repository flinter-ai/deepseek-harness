import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import type { PacketEvidenceClient } from './client.ts'
import type { ResolvedConfig } from './types.ts'

const JSON_OUTPUT = {
  schema: { type: 'json' as const },
  render: (_args: unknown, value: JsonValue): ContentBlock[] => [
    { type: 'text', text: JSON.stringify(value) },
  ],
}

const PROMPT_TEXT =
  'Packet evidence is accessed through the canonical Search-R1 packet service. '
  + 'Use only an opaque `packet_id` and bounded evidence refs; do not request or infer filesystem paths. '
  + 'packet_describe returns metadata without evidence bodies. evidence_get returns recorded evidence only, '
  + 'and distinguishes valid empty results, bounded/truncated views, and service errors. '
  + 'Evidence is advisory for inspection; it does not establish semantic ground truth.'

/** Model-facing arguments of `<prefix>packet_describe`. */
export interface PacketDescribeToolArgs {
  readonly packet_id: string
}

/** Model-facing arguments of `<prefix>evidence_get`; unset bounds stay service-owned. */
export interface EvidenceGetToolArgs {
  readonly packet_id: string
  readonly refs?: string[]
  readonly max_total_chars?: number
  readonly max_item_chars?: number
  readonly max_items?: number
}

/** Named tool-handler seams bound to one protocol client. */
export interface PacketToolHandlers {
  handlePacketDescribe(args: PacketDescribeToolArgs, signal?: AbortSignal): Promise<JsonValue>
  handleEvidenceGet(args: EvidenceGetToolArgs, signal?: AbortSignal): Promise<JsonValue>
}

/**
 * Create the named handlers backing the model tools. Each handler only
 * translates model arguments and forwards the DSH execution signal; all
 * evidence semantics remain in the client and the canonical service.
 * @param client - Canonical packet evidence client.
 * @returns Tool handlers bound to the client.
 */
export function createPacketToolHandlers(client: PacketEvidenceClient): PacketToolHandlers {
  return {
    handlePacketDescribe(args, signal) {
      return client.packetDescribe(args.packet_id, signal)
        .then(value => value as unknown as JsonValue)
    },
    handleEvidenceGet(args, signal) {
      return client.evidenceGet(args.packet_id, {
        ...(args.refs === undefined ? {} : { refs: args.refs }),
        ...(args.max_total_chars === undefined ? {} : { max_total_chars: args.max_total_chars }),
        ...(args.max_item_chars === undefined ? {} : { max_item_chars: args.max_item_chars }),
        ...(args.max_items === undefined ? {} : { max_items: args.max_items }),
      }, signal).then(value => value as unknown as JsonValue)
    },
  }
}

/** Register the model-facing packet tools; evidence semantics stay in Search-R1.
 * @param ctx - Cordis context receiving the tools.
 * @param client - Canonical packet evidence client.
 * @param config - Resolved tool configuration.
 */
export function registerPacketTools(ctx: Context, client: PacketEvidenceClient, config: ResolvedConfig): void {
  const describeName = `${config.toolPrefix}packet_describe`
  const evidenceName = `${config.toolPrefix}evidence_get`
  const { handlePacketDescribe, handleEvidenceGet } = createPacketToolHandlers(client)
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
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => true,
    execute: (args, exec) => handlePacketDescribe(args, exec.signal),
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
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => true,
    execute: (args, exec) => handleEvidenceGet(args, exec.signal),
  }))
}
