/**
 * Keyless S0 segment Loader driver: boots the segment.cordis.yml composition
 * through the real Loader, verifies the five stub tools registered with
 * stable parameter schemas, calls each twice with valid input, and prints the
 * canonical results as JSON lines.
 *
 * The subprocess runs under tsx with the root tsconfig paths facade, so bare
 * `@deepseek-ai/*` imports resolve to source exactly like the headless-agent
 * keyless smoke fixtures. Output-schema validity is enforced by the tools
 * registry itself — a successful (isError: false) result is by construction a
 * schema-valid canonical value. Exits 0 only when every schema assertion
 * passed and every call returned a non-error result — the worker boot → tool
 * call → artifact write path without TowerH, TowerT, VLM, B2, or a live
 * provider.
 */

import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'

const NAME = 'segment-driver'
const [configPath] = process.argv.slice(2)
if (configPath === undefined) {
  throw new Error(`${NAME}: expected <config-path>`)
}

const TOOL_CASES: Record<string, Record<string, unknown>> = {
  'frames.sample': { window: 't0-t1', budget: 12 },
  'track.cotracker': { window: 't0-t1', seeds: ['frame_0', 'frame_1'] },
  'boundary.detect': { track_ref: 'track-abc123' },
  'vlm.ask': { frames_ref: 'frames-abc123', question: 'which gripper holds X?' },
  'artifact.write': { name: 'segments.json', data: { segments: [1, 2, 3] }, out_dir: process.env.SEGMENT_OUT_DIR ?? '/tmp/dsh-segment-smoke' },
}

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
const signal = new AbortController().signal
try {
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  const registered = ctx.tools.schemas().map(schema => schema.name).sort()
  process.stdout.write(`${JSON.stringify({ event: 'tools', names: registered })}\n`)
  const expected = Object.keys(TOOL_CASES).sort()
  if (JSON.stringify(registered) !== JSON.stringify(expected)) {
    throw new Error(`${NAME}: registered tools ${JSON.stringify(registered)} do not match ${JSON.stringify(expected)}`)
  }

  // Schema assertions over the compiled model-visible parameter schemas: every
  // schema is an object root, valid input is accepted, and input missing a
  // required field is rejected.
  const byName = new Map(ctx.tools.schemas().map(schema => [schema.name, schema]))
  for (const toolName of expected) {
    const schema = byName.get(toolName)
    if (schema === undefined) throw new Error(`${NAME}: missing compiled schema for ${toolName}`)
    if (schema.parameters.type !== 'object') {
      throw new Error(`${NAME}: ${toolName} parameters schema did not compile to an object root`)
    }
    const valid = validateJsonSchemaValue(schema.parameters, TOOL_CASES[toolName], '')
    const missingRequired = validateJsonSchemaValue(schema.parameters, {}, '')
    if (valid.length > 0) throw new Error(`${NAME}: ${toolName} rejected valid input: ${valid.join('; ')}`)
    if (missingRequired.length === 0) throw new Error(`${NAME}: ${toolName} accepted input missing a required field`)
    process.stdout.write(`${JSON.stringify({ event: 'schema', name: toolName, valid: true })}\n`)
  }

  for (const [nameKey, arguments_] of Object.entries(TOOL_CASES)) {
    const first = await ctx.tools.execute({ signal, callId: CallId(`smoke-${nameKey}-1`), name: nameKey, arguments: arguments_ })
    const second = await ctx.tools.execute({ signal, callId: CallId(`smoke-${nameKey}-2`), name: nameKey, arguments: arguments_ })
    if (first.isError || second.isError) throw new Error(`${NAME}: ${nameKey} returned an error result`)
    if (JSON.stringify(second.value) !== JSON.stringify(first.value)) {
      throw new Error(`${NAME}: ${nameKey} was not deterministic across calls`)
    }
    process.stdout.write(`${JSON.stringify({ event: 'tool/result', name: nameKey, isError: first.isError, value: first.value })}\n`)
  }
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
