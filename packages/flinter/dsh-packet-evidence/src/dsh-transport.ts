import type { SubprocessRuntime, SubprocessOutcome, SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import {
  DEFAULT_GRACE_MS,
  PACKET_SERVICE_SCHEMA,
  PacketEvidenceError,
  type PacketServiceMethod,
  type PacketServiceResponse,
  type PacketServiceTransport,
  type ResolvedConfig,
} from './types.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function abortError(): PacketEvidenceError {
  const error = new PacketEvidenceError('packet evidence request aborted', 'ABORTED')
  error.name = 'AbortError'
  return error
}

function processFailure(outcome: SubprocessOutcome): PacketEvidenceError {
  const detail = outcome.signal === null
    ? `code ${outcome.exitCode ?? 'unknown'}`
    : `signal ${outcome.signal}`
  return new PacketEvidenceError(`packet service exited before a response (${detail})`, 'NO_RESPONSE')
}

/** DSH-native transport for the Search-R1 packet service process boundary. */
export class DshSubprocessTransport implements PacketServiceTransport {
  private sequence = 0

  constructor(
    private readonly subprocess: SubprocessRuntime,
    private readonly config: ResolvedConfig & { readonly executable: string },
  ) {}

  async request(
    method: PacketServiceMethod,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<PacketServiceResponse> {
    const request = JSON.stringify({
      id: `dsh-${++this.sequence}`,
      method,
      params,
    }) + '\n'

    let handle: SubprocessHandle
    try {
      handle = this.subprocess.spawn({
        argv: [this.config.executable, ...this.config.args, '--registry-root', this.config.registryRoot],
        cwd: this.config.cwd,
        stdio: {
          stdin: { data: request },
          stdout: { maxBytes: this.config.maxResponseBytes },
          stderr: { maxBytes: Math.min(8_192, this.config.maxResponseBytes) },
        },
        graceMs: DEFAULT_GRACE_MS,
        signal,
      })
    } catch (error) {
      if (signal?.aborted) throw abortError()
      throw new PacketEvidenceError(`failed to start packet service: ${String(error)}`, 'SPAWN_FAILED')
    }

    let outcome: SubprocessOutcome
    try {
      outcome = await handle.done
    } catch (error) {
      if (signal?.aborted) throw abortError()
      throw new PacketEvidenceError(`packet service process error: ${String(error)}`, 'PROCESS_ERROR')
    }
    if (signal?.aborted) throw abortError()

    const read = handle.collected.stdout?.readFrom(0)
    if (read === undefined) {
      throw new PacketEvidenceError('packet service did not provide collected stdout', 'INVALID_RESPONSE')
    }
    if (read.lossy) {
      throw new PacketEvidenceError('packet service response exceeds configured byte bound', 'RESPONSE_TOO_LARGE')
    }
    if (outcome.exitCode !== 0 || outcome.signal !== null) {
      throw processFailure(outcome)
    }

    const newline = read.text.indexOf('\n')
    const line = (newline < 0 ? read.text : read.text.slice(0, newline)).trim()
    if (line.length === 0) {
      throw new PacketEvidenceError('packet service returned an empty response', 'INVALID_RESPONSE')
    }
    let decoded: unknown
    try {
      decoded = JSON.parse(line)
    } catch {
      throw new PacketEvidenceError('packet service returned invalid JSON', 'INVALID_RESPONSE')
    }
    if (!isRecord(decoded) || decoded.schema !== PACKET_SERVICE_SCHEMA || typeof decoded.ok !== 'boolean') {
      throw new PacketEvidenceError('packet service returned an incompatible response schema', 'INVALID_RESPONSE')
    }
    return decoded as unknown as PacketServiceResponse
  }
}
