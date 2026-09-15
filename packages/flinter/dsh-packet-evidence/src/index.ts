/**
 * DSH-native FLINTER packet evidence capability.
 *
 * Search-R1 owns packet identity, evidence selection, hash validation, and
 * hard bounds. This package owns only the DSH model-facing capability and
 * delegates process lifecycle to the host's native `ctx.subprocess` seam.
 *
 * @module @deepseek-ai/dsh-packet-evidence
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { PacketEvidenceClient } from './client.ts'
import { DshSubprocessTransport } from './dsh-transport.ts'
import { registerPacketTools } from './tools.ts'
import {
  DEFAULT_LIMITS,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  PACKET_SERVICE_SCHEMA,
  PacketEvidenceError,
  type EvidenceGetOptions,
  type EvidenceLimits,
  type PacketServiceError,
  type PacketServiceMethod,
  type PacketServiceResponse,
  type PacketServiceTransport,
  type ResolvedConfig,
} from './types.ts'

export {
  DEFAULT_LIMITS,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  PACKET_SERVICE_SCHEMA,
  PacketEvidenceError,
  PacketEvidenceClient,
  DshSubprocessTransport,
}
export type {
  EvidenceGetOptions,
  EvidenceLimits,
  PacketServiceError,
  PacketServiceMethod,
  PacketServiceResponse,
  PacketServiceTransport,
  ResolvedConfig,
}

/** Public capability configuration type; the value below is its schema. */
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

/** Schemastery configuration used when this capability is loaded by DSH. */
export const Config: z<Config> = z.object({
  command: z.string().required(),
  args: z.array(z.string()).default([]),
  registryRoot: z.string().required(),
  cwd: z.string().default(''),
  timeoutMs: z.number().step(1).min(1).max(300_000).default(DEFAULT_TIMEOUT_MS),
  maxResponseBytes: z.number().step(1).min(256).max(10_000_000).default(DEFAULT_MAX_RESPONSE_BYTES),
  toolPrefix: z.string().pattern(/^[A-Za-z][A-Za-z0-9_]{0,20}$/).default('flinter_'),
})

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
  return {
    command,
    args,
    registryRoot,
    cwd: config.cwd?.trim() === '' || config.cwd === undefined ? process.cwd() : config.cwd,
    timeoutMs,
    maxResponseBytes,
    toolPrefix,
  }
}

/** Register the native DSH packet evidence capability. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = resolveConfig(config)
  const setupAbort = new AbortController()
  const stopSetupCancellation = ctx.on('internal/plugin', (fiber) => {
    if (fiber === ctx.fiber && fiber.uid === null) {
      setupAbort.abort(new Error('packet-evidence setup disposed'))
    }
  })
  try {
    const executable = await ctx.subprocess.resolveExecutable(resolved.command, undefined, setupAbort.signal)
    setupAbort.signal.throwIfAborted()
    const transport = new DshSubprocessTransport(
      ctx.subprocess as SubprocessRuntime,
      { ...resolved, executable },
    )
    const client = new PacketEvidenceClient(transport)
    registerPacketTools(ctx, client, resolved)
  } finally {
    stopSetupCancellation()
  }
}

/** Plugin object accepted directly by `ctx.plugin(PacketEvidence, config)`. */
export const inject = ['tools', 'systemPrompt', 'subprocess']
const PacketEvidence = { name: 'packet-evidence', inject, Config, apply }

export default PacketEvidence
