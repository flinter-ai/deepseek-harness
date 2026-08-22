/**
 * Keyless S1 segment Loader driver: boots the segment.cordis.yml composition
 * through the real Loader and drives ONLY the semantic surface — the single
 * registered tool RUN_BASELINE_PHYSICS. It asserts the new registration shape
 * (exactly one registered tool, no S0 prototype tool names exposed), validates
 * the request/result schemas, calls the capability twice expecting
 * deterministic abstained results, and proves invalid and unknown calls fail
 * loud on the surface.
 *
 * The subprocess runs under tsx with the root tsconfig paths facade (src
 * mode) or under plain Node with type stripping (lib mode), exactly like the
 * S0 keyless smoke fixtures. Exits 0 only when every schema assertion passed
 * and every expected result materialized — the container boot → semantic
 * capability → artifact write path without TowerH, TowerT, VLM, B2, or a live
 * provider.
 */

import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { validateJsonSchemaValue, valueSchemaSpecToJsonSchema } from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  const registered = ctx.tools.schemas().map(schema => schema.name).sort()
  process.stdout.write(`${JSON.stringify({ event: 'tools', names: registered })}\n`)
  if (registered.length !== 1 || registered[0] !== RUN_BASELINE_PHYSICS) {
    throw new Error(`${NAME}: registered tools ${JSON.stringify(registered)} must be exactly [${RUN_BASELINE_PHYSICS}]`)
  }

  // Request-schema assertions over the compiled model-visible parameter
  // schema: an object root, valid input accepted, input missing the required
  // `window` field rejected.
  const schema = ctx.tools.schemas()[0]!
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

  // Ownership proof: a model-supplied out_dir must NOT move the artifact.
  // The call still succeeds (the extra key is ignored), but the artifact must
  // land at the runtime/config-owned path, never at the model-chosen one.
  const modelChosen = join(tmpdir(), 'model-chosen-path')
  const withOutDir = await ctx.tools.execute({
    signal,
    callId: CallId('smoke-baseline-physics-outdir'),
    name: RUN_BASELINE_PHYSICS,
    arguments: { window: 't0-t1', out_dir: modelChosen },
  })
  if (withOutDir.isError) throw new Error(`${NAME}: out_dir-supplied call should still succeed (key is ignored, path is runtime-owned)`)
  if (existsSync(modelChosen)) throw new Error(`${NAME}: model-supplied out_dir moved the artifact; path must stay runtime/config-owned`)
  const ownedDir = process.env.SEGMENT_OUT_DIR ?? '/tmp/dsh-segment-smoke'
  if (!existsSync(join(ownedDir, 'baseline-physics.json'))) {
    throw new Error(`${NAME}: artifact missing at runtime-owned path ${ownedDir}`)
  }
  process.stdout.write(`${JSON.stringify({ event: 'semantic/out_dir-ignored', name: RUN_BASELINE_PHYSICS, runtimeOwnsPath: true })}\n`)

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
