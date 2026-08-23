/**
 * @flinter/dsh-pes engine seam — the only path from the plugin to the
 * searchable-trace engine.
 *
 * The engine is the `event_index.query` JSON-lines CLI from the producer slice
 * (flinter-ai/flinter-common `feat/searchable-trace-engine`, immutable SHA
 * `c05c3fc747f0aa0fcb9d0603009add71c59e091b`). This plugin NEVER imports the
 * engine package or any sibling checkout: it spawns the CLI as an explicitly
 * configured subprocess command (`config.command`, else `$PES_QUERY_COMMAND`,
 * else the packaged-entry default) and speaks the documented stdin JSONL
 * protocol — one request object per line, one response object per line.
 *
 * Runtime engine packaging (making `python3 -m event_index.query` importable
 * at deploy time) and pinning the immutable producer SHA are integration-gate
 * work, NOT completed by this plugin PR: the seam fails loud as a structured
 * `engine-unavailable` / `engine-nonzero-exit` result when the command cannot
 * run, and the envelope omits `provenance.engine_pin` until a deployment pins
 * it.
 *
 * Bounded-ness invariants: result `n` is clamped to the corpus by the engine
 * and capped here; stdout is capped by MAX_STDOUT_BYTES; stderr by
 * MAX_STDERR_BYTES; the subprocess deadline is a validated Config field.
 */

import { spawn } from 'node:child_process'

export const ENGINE_PROTOCOL = 'event_index.query stdin-jsonl v1'
export const DEFAULT_ENGINE_COMMAND = ['python3', '-m', 'event_index.query']
export const DEFAULT_TIMEOUT_MS = 30_000
export const MAX_TIMEOUT_MS = 120_000
export const MAX_STDOUT_BYTES = 8 * 1024 * 1024
export const MAX_STDERR_BYTES = 256 * 1024

/**
 * Resolve the events index path: plugin config wins, then the engine's own
 * environment variable, then nothing (a missing source fails loud at call
 * time — never a cwd-relative guess).
 * @returns the resolved path or `undefined` when unconfigured.
 */
export function resolveEventsPath(config, env) {
  if (config.events !== undefined) return config.events
  return env.PES_EVENTS_ENRICHED_JSONL ?? undefined
}

/**
 * Full argv for one engine invocation: the configured command (mode-less,
 * events-less, in stdin JSONL mode) plus the explicit `--events` flag. The
 * plugin always appends the resolved events path so the index never depends
 * on the engine's environment; argparse last-wins makes a duplicate
 * `--events` inside a custom command deterministic (the plugin's value).
 * @returns the argv vector.
 */
export function resolveEngineArgv(command, eventsPath) {
  return [...command, '--events', eventsPath]
}

/**
 * Validate the plugin's engine-relevant config fields at load time.
 * Misconfiguration fails loud here, never silently at call time.
 * @param config - the plugin config object.
 * @throws TypeError on a malformed field.
 */
export function validateEngineConfig(config) {
  if (config.command !== undefined) {
    if (!Array.isArray(config.command) || config.command.length === 0
      || !config.command.every(part => typeof part === 'string' && part.trim() !== '')) {
      throw new TypeError('[dsh-pes] config.command must be a non-empty array of non-empty strings')
    }
  }
  const timeoutMs = config.timeout_ms ?? config.timeoutMs
  if (timeoutMs !== undefined) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
      throw new TypeError(`[dsh-pes] config.timeout_ms (or config.timeoutMs) must be an integer in [1, ${MAX_TIMEOUT_MS}]`)
    }
  }
  for (const field of ['events', 'artifacts_root', 'artifactsRoot', 'engine_pin', 'enginePin']) {
    const value = config[field]
    if (value !== undefined && typeof value !== 'string') {
      throw new TypeError(`[dsh-pes] config.${field} must be a string when set`)
    }
  }
}

/**
 * Resolve the engine configuration a call runs under: plugin config, then the
 * engine-namespaced environment, then the packaged defaults.
 * @param config - validated plugin config.
 * @param env - environment snapshot (process.env at load time).
 * @returns the resolved, validated engine config.
 */
export function resolveEngineConfig(config, env) {
  validateEngineConfig(config)
  let command = config.command
  if (command === undefined && env.PES_QUERY_COMMAND !== undefined) {
    try {
      const parsed = JSON.parse(env.PES_QUERY_COMMAND)
      if (!Array.isArray(parsed) || parsed.length === 0
        || !parsed.every(part => typeof part === 'string' && part.trim() !== '')) {
        throw new TypeError('PES_QUERY_COMMAND must be a JSON array of non-empty strings')
      }
      command = parsed
    } catch (error) {
      throw new TypeError(`[dsh-pes] PES_QUERY_COMMAND must be a JSON array of non-empty strings: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const timeoutMs = config.timeout_ms ?? config.timeoutMs
  const artifactsRoot = config.artifacts_root ?? config.artifactsRoot
  const enginePin = config.engine_pin ?? config.enginePin
  return {
    command: command ?? DEFAULT_ENGINE_COMMAND,
    eventsPath: resolveEventsPath(config, env),
    timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
    artifactsRoot: artifactsRoot ?? env.PES_ARTIFACTS_ROOT ?? undefined,
    enginePin: enginePin ?? undefined,
  }
}

/**
 * Parse the engine's stdout as the documented single-response protocol:
 * exactly one non-empty JSON object line.
 * @returns `{ response }` or `{ problem }` describing the protocol violation.
 */
export function parseSingleResponse(stdout) {
  const lines = stdout.split('\n').map(line => line.trim()).filter(line => line !== '')
  if (lines.length === 0) {
    return { problem: 'engine produced no output' }
  }
  if (lines.length > 1) {
    return { problem: `engine produced ${lines.length} response lines; the stdin protocol is one request -> one response` }
  }
  let response
  try {
    response = JSON.parse(lines[0])
  } catch (error) {
    return { problem: `engine output is not a JSON object line: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (typeof response !== 'object' || response === null || Array.isArray(response)) {
    return { problem: 'engine output is not a JSON object' }
  }
  return { response }
}

/**
 * Validate a non-error engine response against the envelope contract. An
 * engine-reported per-request `{"error": ...}` is NOT a protocol violation —
 * it is the engine's structured rejection, classified by the caller.
 */
export function envelopeViolation(response) {
  if (typeof response.mode !== 'string' || response.mode === '') return 'missing string mode'
  if (!Array.isArray(response.event_ids)) return 'missing event_ids array'
  if (!Array.isArray(response.events)) return 'missing events array'
  if (typeof response.abstained !== 'boolean') return 'missing boolean abstained'
  return null
}

/**
 * Spawn one engine invocation, write one request line to stdin, and await the
 * response. Never throws: every failure mode settles as a structured error
 * object with a `kind` from the plugin's error taxonomy.
 *
 * @param command - resolved engine argv (already includes `--events`).
 * @param request - the JSON request object for one query mode.
 * @param options - `{ eventsPath, timeoutMs, env }` from the resolved config.
 * @returns `{ ok: true, response }` or `{ ok: false, error }` where error is
 *   `{ kind, message, ... }` with kind ∈ engine-unavailable | engine-timeout |
 *   engine-nonzero-exit | engine-malformed-response | malformed-input.
 */
export function spawnEngineQuery(command, request, options) {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      env: { ...(options.env ?? {}), PES_EVENTS_ENRICHED_JSONL: options.eventsPath },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let stdoutOverflow = false
    let stderrOverflow = false
    let settled = false

    const settle = (outcome) => {
      if (settled) return
      settled = true
      if (child.exitCode === null) child.kill('SIGKILL')
      resolve(outcome)
    }

    child.stdout.on('data', (chunk) => {
      if (stdout.length >= MAX_STDOUT_BYTES) {
        stdoutOverflow = true
        return
      }
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      if (stderr.length >= MAX_STDERR_BYTES) {
        stderrOverflow = true
        return
      }
      stderr += chunk
    })

    const timer = setTimeout(() => {
      settle({
        ok: false,
        error: {
          kind: 'engine-timeout',
          message: `engine command did not respond within ${options.timeoutMs}ms: ${command.join(' ')}`,
          command,
        },
      })
    }, options.timeoutMs)

    child.on('error', (error) => {
      clearTimeout(timer)
      settle({
        ok: false,
        error: {
          kind: 'engine-unavailable',
          message: `engine command could not be started: ${error?.message ?? String(error)}`,
          command,
        },
      })
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (settled) return
      if (stdoutOverflow) {
        settle({
          ok: false,
          error: {
            kind: 'engine-malformed-response',
            message: `engine stdout exceeded the ${MAX_STDOUT_BYTES}-byte cap`,
            command,
          },
        })
        return
      }
      const parsed = parseSingleResponse(stdout)
      if (code !== 0) {
        if (parsed.response !== undefined && parsed.response.error !== undefined) {
          settle({
            ok: false,
            error: {
              kind: 'malformed-input',
              message: `engine rejected the request: ${parsed.response.error}`,
              engine_error: parsed.response.error,
              line: parsed.response.line,
              command,
            },
          })
          return
        }
        settle({
          ok: false,
          error: {
            kind: 'engine-nonzero-exit',
            message: `engine exited ${code}${stderrOverflow ? ' (stderr truncated)' : ''}: ${stderr.trim() || 'no stderr'}`,
            exit_code: code,
            stderr: stderrOverflow ? undefined : stderr,
            command,
          },
        })
        return
      }
      if (parsed.problem !== undefined) {
        settle({
          ok: false,
          error: { kind: 'engine-malformed-response', message: parsed.problem, command },
        })
        return
      }
      const response = parsed.response
      if (response.error !== undefined) {
        settle({
          ok: false,
          error: {
            kind: 'malformed-input',
            message: `engine rejected the request: ${response.error}`,
            engine_error: response.error,
            line: response.line,
            command,
          },
        })
        return
      }
      const violation = envelopeViolation(response)
      if (violation !== null) {
        settle({
          ok: false,
          error: {
            kind: 'engine-malformed-response',
            message: `engine response violates the protocol (${violation})`,
            command,
          },
        })
        return
      }
      settle({ ok: true, response })
    })

    child.stdin.on('error', () => { /* the engine closed stdin: settle via close */ })
    child.stdin.write(`${JSON.stringify(request)}\n`)
    child.stdin.end()
  })
}
