#!/usr/bin/env node
/**
 * aws-headless runtime semantic/trace E2E driver.
 *
 * Boots the REAL assembled aws-headless profile (base + dsh-orca +
 * dsh-segment + dsh-pes + AWS Secrets Manager credentials + Bedrock route)
 * through the Loader and drives exactly two tools:
 *
 * - `RUN_BASELINE_PHYSICS` as an INTERFACE CHECK ONLY: the driver requires the
 *   honest `abstention: 'prototype_stub'` marker and reports the result as a
 *   stub-interface check. It is never presented as scientific TowerH success.
 * - `search_events` with deterministic arguments from
 *   `$PES_TRACE_TASK_ARGS` (`["--query", "...", "--n", "..."]`, else the
 *   packaged defaults) against the runtime-provided corpus
 *   (`$PES_EVENTS_ENRICHED_JSONL`, passed to the engine as `--events`) and the
 *   runtime engine command (`$PES_QUERY_COMMAND`, else
 *   `python3 -m event_index.query`). The driver requires `status: completed`,
 *   `abstained: false`, bounded results (`count >= 1`, `count <= n`,
 *   `bounded: true`, arrays consistent), and the immutable producer engine
 *   pin `c05c3fc747f0aa0fcb9d0603009add71c59e091b` in
 *   `provenance.engine_pin`.
 *
 * When `$PES_TRACE_*` transport is configured (callback URL present), the
 * driver additionally requires the plugin's runtime-owned automatic trace
 * emission to report `accepted` for the completed search result; any
 * non-accepted outcome (validation-rejected, unauthorized, conflict, rejected,
 * unavailable, unreachable, unexpected) is a trace transport failure.
 *
 * The driver emits EXACTLY ONE bounded machine-readable JSON summary on
 * stdout and exits nonzero for: missing corpus (2), engine unavailable/failed
 * (3), abstention (4), malformed provenance (5), trace transport failure (6),
 * or a failed RUN_BASELINE_PHYSICS interface check (7). Boot/composition
 * failures exit 1. No LLM/model decision is made anywhere: this is a runtime
 * semantic/trace E2E, not scientific TowerH proof.
 *
 * Production mode NEVER falls back to a test fixture engine: the engine seam
 * resolves to `$PES_QUERY_COMMAND` or the packaged
 * `python3 -m event_index.query` command, and an unusable engine surfaces as
 * a structured `engine-*` result that fails the run.
 *
 * Entrypoint (the invocation the data-infra runtime must supply):
 *
 * ```sh
 * node --import tsx/esm examples/aws-headless/runtime-driver.js
 * ```
 *
 * with `DSH_HOME` pointing at a home whose `profiles/aws-headless` is
 * materialized (the assembled profile), plus the runtime environment:
 * `PES_EVENTS_ENRICHED_JSONL` (corpus), `PES_QUERY_COMMAND` (engine; omit for
 * the packaged default), and the `PES_TRACE_*` profile, deterministic task
 * arguments, transport, and ancestry variables.
 */

import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, healProfilesModuleFallback, installFailLoud, loadProfile } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { CallId } from '@deepseek-ai/dsh-llm'

const NAME = 'aws-headless-runtime-driver'
const [profileNameArg] = process.argv.slice(2)
const profileName = process.env.PES_TRACE_AWS_PROFILE ?? profileNameArg ?? 'aws-headless'
const INSTALL_ANCHOR = fileURLToPath(new URL('../../apps/cli/package.json', import.meta.url))

const RUN_BASELINE_PHYSICS = 'RUN_BASELINE_PHYSICS'
const SEARCH_EVENTS = 'search_events'
const EXPECTED_ENGINE_PIN = 'c05c3fc747f0aa0fcb9d0603009add71c59e091b'
const EXPECTED_PES_PLUGIN = '@flinter/dsh-pes'
const DEFAULT_SEARCH_QUERY = 'cup acquisition'
const DEFAULT_SEARCH_N = 3
const REQUESTED_BUDGET = 12

const SUMMARY_SCHEMA = 'aws-headless-runtime-semantic-trace-e2e.v1'
const SUMMARY_KIND = 'runtime-semantic-trace-e2e'
const MAX_REPORTED_EVENT_IDS = 20
const MAX_REASON_LENGTH = 400

/** Exit codes: 0 pass; every listed failure class is nonzero. */
const EXIT = {
  pass: 0,
  boot: 1,
  missingCorpus: 2,
  engine: 3,
  abstention: 4,
  provenance: 5,
  trace: 6,
  baseline: 7,
}

const TRACE_LOG_PREFIX = '[dsh-pes] trace emission : '

/**
 * Bounded human detail for a failure summary; keeps the single machine
 * summary line bounded whatever the underlying error text.
 * @param error - the thrown error or reason string.
 * @returns a bounded reason string.
 */
function boundedReason(error) {
  const text = error instanceof Error ? error.message : String(error ?? '')
  const singleLine = text.replace(/\s+/g, ' ').trim()
  return singleLine.length > MAX_REASON_LENGTH
    ? `${singleLine.slice(0, MAX_REASON_LENGTH)}...`
    : singleLine
}

/** Parse the control-plane-owned deterministic search arguments. */
function parseTaskArgs(raw) {
  if (raw === undefined || raw === '') {
    return { query: DEFAULT_SEARCH_QUERY, searchN: DEFAULT_SEARCH_N }
  }
  const args = JSON.parse(raw)
  if (!Array.isArray(args) || !args.every(argument => typeof argument === 'string')) {
    throw new Error('PES_TRACE_TASK_ARGS must be a JSON array of strings')
  }
  let query = DEFAULT_SEARCH_QUERY
  let searchN = DEFAULT_SEARCH_N
  const seen = new Set()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if ((flag !== '--query' && flag !== '--n') || value === undefined || seen.has(flag)) {
      throw new Error('PES_TRACE_TASK_ARGS accepts each of --query and --n at most once')
    }
    seen.add(flag)
    if (flag === '--query') {
      if (value.trim() === '') throw new Error('PES_TRACE_TASK_ARGS --query must not be empty')
      query = value
    } else {
      const parsed = Number(value)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
        throw new Error('PES_TRACE_TASK_ARGS --n must be an integer from 1 to 20')
      }
      searchN = parsed
    }
  }
  return { query, searchN }
}

const uninstallFailLoud = installFailLoud(NAME)
let ctx
let outcome = { code: EXIT.boot, reason: 'driver did not run' }

try {
  const eventsPath = process.env.PES_EVENTS_ENRICHED_JSONL
  if (eventsPath === undefined || eventsPath === '') {
    outcome = {
      code: EXIT.missingCorpus,
      reason: 'no events index configured: set $PES_EVENTS_ENRICHED_JSONL',
    }
  } else if (!existsSync(eventsPath)) {
    outcome = {
      code: EXIT.missingCorpus,
      reason: `events index does not exist: ${eventsPath}`,
    }
  } else {
    const traceConfigured = process.env.PES_TRACE_CALLBACK_URL !== undefined
    const { query, searchN } = parseTaskArgs(process.env.PES_TRACE_TASK_ARGS)

    // Trace emission outcomes reported by the plugin's runtime-owned emitter,
    // captured through the root logger exporter (status + deterministic id;
    // never the body, signature, or secret).
    const traceOutcomes = []
    const captureTraceOutcome = (message) => {
      const text = typeof message.args[0] === 'string' ? message.args[0] : ''
      if (!text.startsWith(TRACE_LOG_PREFIX)) return
      const status = text.slice(TRACE_LOG_PREFIX.length)
      const meta = message.args[1]
      const id = meta !== null && typeof meta === 'object' && typeof meta.id === 'string' ? meta.id : undefined
      traceOutcomes.push({ status, id })
    }

    healProfilesModuleFallback(INSTALL_ANCHOR)
    const profile = loadProfile(NAME, profileName, INSTALL_ANCHOR)
    const patches = [
      ...profile.layers.flatMap(layer => layer.patches),
      ...profile.patches,
      // Deterministic boot: the settings document is pinned into this run's
      // DSH_HOME and session telemetry stays off, exactly like the keyless
      // aws-headless smokes, so no machine-local file can decide the boot.
      { id: 'settings', config: { path: join(resolveDshHome(), 'settings.yaml'), watch: false } },
      { id: 'session-telemetry-otel', disabled: true },
    ]
    ctx = await boot(NAME, join(profile.dir, 'cordis.yml'), patches, (hostCtx) => {
      provideCmdline(hostCtx, { args: [], exit: () => {} })
    })
    ctx.logger.exporter({ export: captureTraceOutcome })

    const registered = ctx.tools.schemas().map(schema => schema.name)
    for (const tool of [RUN_BASELINE_PHYSICS, SEARCH_EVENTS]) {
      if (!registered.includes(tool)) {
        throw new Error(`registered tool ${tool} is missing from the composed profile`)
      }
    }

    const signal = new AbortController().signal

    // RUN_BASELINE_PHYSICS — interface check only. The honest
    // `prototype_stub` abstention is REQUIRED; a stub output is never
    // reported as scientific success.
    const baseline = await ctx.tools.execute({
      signal,
      callId: CallId('runtime-driver-baseline-physics'),
      name: RUN_BASELINE_PHYSICS,
      arguments: { window: 't0-t1', budget: REQUESTED_BUDGET },
    })
    if (baseline.isError) {
      outcome = {
        code: EXIT.baseline,
        reason: `${RUN_BASELINE_PHYSICS} returned an error result instead of the prototype_stub interface check`,
      }
    } else {
      const baselineValue = baseline.value
      if (baselineValue?.status !== 'completed' || baselineValue?.abstention !== 'prototype_stub') {
        outcome = {
          code: EXIT.baseline,
          reason: `${RUN_BASELINE_PHYSICS} did not report the honest prototype_stub abstention (${JSON.stringify(baselineValue).slice(0, MAX_REASON_LENGTH)})`,
        }
      } else {
        // search_events — deterministic query against the runtime corpus and
        // engine, pinning the completed/non-abstained/bounded contract.
        const search = await ctx.tools.execute({
          signal,
          callId: CallId('runtime-driver-search-events'),
          name: SEARCH_EVENTS,
          arguments: { query, n: searchN },
        })
        if (search.isError) {
          outcome = { code: EXIT.boot, reason: `${SEARCH_EVENTS} returned an error result on the surface` }
        } else {
          const value = search.value
          if (value?.status === 'error') {
            const kind = value.error?.kind
            if (kind !== undefined && kind.startsWith('engine-')) {
              outcome = {
                code: EXIT.engine,
                reason: `${SEARCH_EVENTS} engine failure (${kind}): ${boundedReason(value.error?.message ?? kind)}`,
              }
            } else {
              outcome = { code: EXIT.boot, reason: `${SEARCH_EVENTS} structured error (${kind ?? 'unknown'}): ${boundedReason(value.error?.message ?? 'no detail')}` }
            }
          } else if (value?.status === 'abstained' || value?.abstained === true) {
            outcome = { code: EXIT.abstention, reason: `${SEARCH_EVENTS} abstained on the runtime corpus` }
          } else if (value?.status !== 'completed' || value?.abstained !== false) {
            outcome = { code: EXIT.boot, reason: `${SEARCH_EVENTS} result is neither completed nor a structured failure` }
          } else {
            const provenance = value.provenance
            const pinned = provenance?.engine_pin === EXPECTED_ENGINE_PIN
            if (provenance?.plugin !== EXPECTED_PES_PLUGIN
              || typeof provenance?.engine !== 'string'
              || typeof provenance?.engine_protocol !== 'string'
              || !pinned) {
              outcome = {
                code: EXIT.provenance,
                reason: `${SEARCH_EVENTS} provenance is malformed or unpinned (expected engine_pin ${EXPECTED_ENGINE_PIN})`,
              }
            } else {
              const eventIds = value.event_ids
              const events = value.events
              const bounded = value.bounded === true
                && Number.isInteger(value.count)
                && value.count >= 1
                && value.count <= searchN
                && Array.isArray(eventIds)
                && Array.isArray(events)
                && eventIds.length === value.count
                && events.length === value.count
              if (!bounded) {
                outcome = { code: EXIT.boot, reason: `${SEARCH_EVENTS} result is not bounded (count/arrays inconsistent with n=${searchN})` }
              } else {
                const traceOutcome = traceOutcomes[traceOutcomes.length - 1]
                if (traceConfigured && (traceOutcome === undefined || traceOutcome.status !== 'accepted')) {
                  outcome = {
                    code: EXIT.trace,
                    reason: `trace emission did not report accepted (${traceOutcome?.status ?? 'no emission'})`,
                  }
                } else {
                  // One bounded machine-readable summary: the full pass state.
                  outcome = {
                    code: EXIT.pass,
                    summary: {
                      driver: NAME,
                      schema: SUMMARY_SCHEMA,
                      kind: SUMMARY_KIND,
                      scientific_proof: false,
                      profile: profileName,
                      corpus: basename(eventsPath),
                      run: { query, requested_n: searchN },
                      baseline_physics: {
                        status: baselineValue.status,
                        abstention: baselineValue.abstention,
                        interface_check_only: true,
                      },
                      search_events: {
                        status: value.status,
                        abstained: value.abstained,
                        count: value.count,
                        requested_n: searchN,
                        bounded: true,
                        artifact_verification: value.artifact_verification,
                        engine_pin: provenance.engine_pin,
                        event_ids: eventIds.slice(0, MAX_REPORTED_EVENT_IDS),
                      },
                      trace_emission: traceConfigured
                        ? { configured: true, status: traceOutcome.status, record_id: traceOutcome.id }
                        : { configured: false },
                      exit_code: EXIT.pass,
                    },
                  }
                }
              }
            }
          }
        }
      }
    }
  }
} catch (error) {
  outcome = { code: EXIT.boot, reason: boundedReason(error) }
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}

if (outcome.code !== EXIT.pass) {
  process.stderr.write(`${NAME}: ${outcome.reason}\n`)
  process.stdout.write(`${JSON.stringify({
    driver: NAME,
    schema: SUMMARY_SCHEMA,
    kind: SUMMARY_KIND,
    scientific_proof: false,
    profile: profileName,
    status: 'fail',
    reason: outcome.reason,
    exit_code: outcome.code,
  })}\n`)
} else {
  process.stdout.write(`${JSON.stringify(outcome.summary)}\n`)
}
process.exitCode = outcome.code
