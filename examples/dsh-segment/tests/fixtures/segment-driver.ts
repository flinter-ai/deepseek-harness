/**
 * Keyless S1 segment Loader driver: boots a real Cordis composition through
 * the Loader and drives ONLY the semantic surface — the single registered
 * tool RUN_BASELINE_PHYSICS. It asserts the registration shape (exactly one
 * registered tool in `exact` mode, or RUN_BASELINE_PHYSICS present with no S0
 * prototype names in `includes` mode), validates the request/result schemas,
 * calls the capability twice expecting deterministic abstained results, and
 * proves the fail-closed terminal paths on the surface: schema-level invalid
 * requests, adapter-level non-positive-budget violations, unknown request keys
 * (a model-supplied out_dir), and unknown capability names.
 *
 * Modes and boot shape are selected by environment:
 * - `SEGMENT_ROSTER_MODE=exact` (default) boots the hand-written fixture
 *   composition and asserts exactly [RUN_BASELINE_PHYSICS].
 * - `SEGMENT_ROSTER_MODE=includes` with `SEGMENT_PATCHES` (path-separated
 *   bundle patch files) boots the ASSEMBLED composition — base + headless +
 *   segment bundle layers applied by boot() exactly as the dsh profile
 *   launcher mounts the headless profile in the worker image — and asserts
 *   RUN_BASELINE_PHYSICS is registered and the S0 primitives are not.
 *
 * The subprocess runs under tsx with the root tsconfig paths facade (src
 * mode) or under plain Node with type stripping (lib mode), exactly like the
 * S0 keyless smoke fixtures. Exits 0 only when every schema assertion passed
 * and every expected result materialized — the container boot → semantic
 * capability → artifact write path without TowerH, TowerT, VLM, B2, or a live
 * provider.
 */

import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud, loadOverlayPatches, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { validateJsonSchemaValue, valueSchemaSpecToJsonSchema } from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import {
  RUN_BASELINE_PHYSICS,
  runBaselinePhysicsResult,
} from '../../capabilities/run-baseline-physics.js'

const NAME = 'segment-driver'
const [configPath] = process.argv.slice(2)
if (configPath === undefined) {
  throw new Error(`${NAME}: expected <config-path>`)
}

const VALID_REQUEST: Record<string, unknown> = {
  window: 't0-t1',
  budget: 12,
}

const S0_PRIMITIVE_TOOLS = ['frames.sample', 'track.cotracker', 'boundary.detect', 'vlm.ask', 'artifact.write']

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
const signal = new AbortController().signal
let semanticCalls = 0

async function runSemantic(ctx: Context) {
  semanticCalls += 1
  const result = await ctx.tools.execute({
    signal,
    callId: CallId(`smoke-baseline-physics-${semanticCalls}`),
    name: RUN_BASELINE_PHYSICS,
    arguments: VALID_REQUEST,
  })
  if (result.isError) throw new Error(`${NAME}: ${RUN_BASELINE_PHYSICS} returned an error result`)
  return result
}

try {
  const rootConfig = resolveConfigPath(configPath, undefined)
  const patchesEnv = process.env.SEGMENT_PATCHES
  if (patchesEnv !== undefined) {
    const patchFiles = patchesEnv.split(delimiter).filter(file => file.length > 0)
    if (patchFiles.length === 0) throw new Error(`${NAME}: SEGMENT_PATCHES is set but empty`)
    const layers = patchFiles.map(file => loadOverlayPatches(NAME, file))
    // The one-shot headless task runner is inert in this smoke: it would need
    // a live model and belongs to the task-mode track, not the tool surface.
    layers.push([{ id: 'headless-runner', disabled: true }])
    ctx = await boot(NAME, rootConfig, layers.flat(), (hostCtx) => {
      provideCmdline(hostCtx, { args: ['assembled smoke boot-only; no task mode'], exit: () => {} })
    })
  } else {
    ctx = await boot(NAME, rootConfig)
  }

  const registered = ctx.tools.schemas().map(schema => schema.name).sort()
  const rosterMode = process.env.SEGMENT_ROSTER_MODE ?? 'exact'
  if (rosterMode === 'exact') {
    if (registered.length !== 1 || registered[0] !== RUN_BASELINE_PHYSICS) {
      throw new Error(`${NAME}: registered tools ${JSON.stringify(registered)} must be exactly [${RUN_BASELINE_PHYSICS}]`)
    }
  } else if (rosterMode === 'includes') {
    if (!registered.includes(RUN_BASELINE_PHYSICS)) {
      throw new Error(`${NAME}: assembled tree must register ${RUN_BASELINE_PHYSICS}, got ${JSON.stringify(registered)}`)
    }
    const primitives = S0_PRIMITIVE_TOOLS.filter(name => registered.includes(name))
    if (primitives.length > 0) {
      throw new Error(`${NAME}: S0 prototype tools must not be registered in the assembled tree: ${JSON.stringify(primitives)}`)
    }
  } else {
    throw new Error(`${NAME}: SEGMENT_ROSTER_MODE must be 'exact' or 'includes', got ${JSON.stringify(rosterMode)}`)
  }
  process.stdout.write(`${JSON.stringify({ event: 'tools', names: registered, rosterMode })}\n`)

  // Request-schema assertions over the compiled model-visible parameter
  // schema: an object root, valid input accepted, input missing the required
  // `window` field rejected.
  const schema = ctx.tools.schemas().find(schema => schema.name === RUN_BASELINE_PHYSICS)
  if (schema === undefined) throw new Error(`${NAME}: ${RUN_BASELINE_PHYSICS} schema is missing from the roster`)
  if (schema.parameters.type !== 'object') {
    throw new Error(`${NAME}: ${schema.name} parameters schema did not compile to an object root`)
  }
  const valid = validateJsonSchemaValue(schema.parameters, VALID_REQUEST, '')
  const missingRequired = validateJsonSchemaValue(schema.parameters, {}, '')
  if (valid.length > 0) throw new Error(`${NAME}: valid request was rejected: ${valid.join('; ')}`)
  if (missingRequired.length === 0) throw new Error(`${NAME}: request missing a required field was accepted`)
  process.stdout.write(`${JSON.stringify({ event: 'schema', name: schema.name, valid: true })}\n`)

  const first = await runSemantic(ctx)
  const second = await runSemantic(ctx)
  if (JSON.stringify(second.value) !== JSON.stringify(first.value)) {
    throw new Error(`${NAME}: ${RUN_BASELINE_PHYSICS} was not deterministic across calls`)
  }
  const violations = validateJsonSchemaValue(valueSchemaSpecToJsonSchema(runBaselinePhysicsResult), first.value, 'result')
  if (violations.length > 0) {
    throw new Error(`${NAME}: result violates the semantic result schema: ${violations.join('; ')}`)
  }
  process.stdout.write(`${JSON.stringify({ event: 'semantic/result', request: VALID_REQUEST, value: first.value })}\n`)
  process.stdout.write(`${JSON.stringify({ event: 'semantic/result', request: VALID_REQUEST, value: second.value })}\n`)

  const invalid = await ctx.tools.execute({
    signal,
    callId: CallId('smoke-baseline-physics-invalid'),
    name: RUN_BASELINE_PHYSICS,
    arguments: {},
  })
  if (!invalid.isError) throw new Error(`${NAME}: input missing the required field was not rejected`)
  process.stdout.write(`${JSON.stringify({ event: 'semantic/invalid', name: RUN_BASELINE_PHYSICS, isError: invalid.isError })}\n`)

  // Schema-level fail-closed: a non-integer budget violates the compiled
  // parameter schema (`type: integer`) before the adapter runs.
  const nonInteger = await ctx.tools.execute({
    signal,
    callId: CallId('smoke-baseline-physics-non-integer'),
    name: RUN_BASELINE_PHYSICS,
    arguments: { window: 't0-t1', budget: 2.5 },
  })
  if (!nonInteger.isError) throw new Error(`${NAME}: non-integer budget was not rejected by the request schema`)
  process.stdout.write(`${JSON.stringify({ event: 'semantic/schema-reject', name: RUN_BASELINE_PHYSICS, isError: nonInteger.isError, error: nonInteger.error.message })}\n`)

  // Adapter-level fail-closed: a non-positive integer budget passes the schema
  // (which cannot express positivity) and is rejected by the
  // adapter itself, before any stage runs. No artifact/provenance is
  // fabricated for the failing invocation.
  const bounded = await ctx.tools.execute({
    signal,
    callId: CallId('smoke-baseline-physics-bounded'),
    name: RUN_BASELINE_PHYSICS,
    arguments: { window: 't0-t1', budget: 0 },
  })
  if (!bounded.isError) throw new Error(`${NAME}: non-positive budget was not rejected fail-closed`)
  if (!bounded.error.message.includes('fail-closed') || !bounded.error.message.includes('budget')) {
    throw new Error(`${NAME}: invalid-budget failure did not carry the fail-closed contract message: ${bounded.error.message}`)
  }
  process.stdout.write(`${JSON.stringify({ event: 'semantic/failure', name: RUN_BASELINE_PHYSICS, isError: bounded.isError, failClosed: true, error: bounded.error.message })}\n`)

  // Ownership proof: a model-supplied out_dir is an unknown request key and
  // is REJECTED fail-closed — the artifact path stays runtime/config-owned,
  // and the model-chosen path is never created.
  const modelChosen = join(tmpdir(), 'model-chosen-path')
  const withOutDir = await ctx.tools.execute({
    signal,
    callId: CallId('smoke-baseline-physics-outdir'),
    name: RUN_BASELINE_PHYSICS,
    arguments: { window: 't0-t1', out_dir: modelChosen },
  })
  if (!withOutDir.isError) throw new Error(`${NAME}: model-supplied out_dir was not rejected as an unknown request key`)
  if (!withOutDir.error.message.includes('unknown request key')) {
    throw new Error(`${NAME}: out_dir rejection did not name the unknown request key: ${withOutDir.error.message}`)
  }
  if (existsSync(modelChosen)) throw new Error(`${NAME}: model-supplied out_dir moved the artifact; path must stay runtime/config-owned`)
  const ownedDir = process.env.SEGMENT_OUT_DIR ?? '/tmp/dsh-segment-smoke'
  if (!existsSync(join(ownedDir, 'baseline-physics.json'))) {
    throw new Error(`${NAME}: artifact missing at runtime-owned path ${ownedDir}`)
  }
  process.stdout.write(`${JSON.stringify({ event: 'semantic/unknown-key', name: RUN_BASELINE_PHYSICS, isError: true, failClosed: true, runtimeOwnsPath: true })}\n`)

  const phantom = await ctx.tools.execute({
    signal,
    callId: CallId('smoke-baseline-physics-phantom'),
    name: 'PHANTOM_CAPABILITY',
    arguments: {},
  })
  if (!phantom.isError) throw new Error(`${NAME}: unknown tool name should surface as an error result`)
  process.stdout.write(`${JSON.stringify({ event: 'semantic/unknown', name: 'PHANTOM_CAPABILITY', isError: phantom.isError })}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
