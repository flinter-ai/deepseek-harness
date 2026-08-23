/**
 * Keyless dsh-pes Loader driver: boots the pes.cordis.yml composition through
 * the real Loader and drives the four registered tools through the tools
 * surface (search_events, find_similar_states, find_counterfactuals, zoom).
 * It asserts the registration shape (exactly those four names), validates the
 * request/result schemas, calls each tool twice expecting deterministic
 * bounded envelopes with provenance, proves the malformed-input structured
 * error (schema-valid but semantically invalid zoom window), and proves
 * schema violations and unknown tool names fail loud on the surface.
 *
 * The engine behind the tools is the protocol-compatible fixture stub selected
 * by $PES_QUERY_COMMAND — the seam itself is what is under test. Artifact
 * references (`source_path` on returned events) must resolve under
 * $PES_ARTIFACTS_ROOT, so artifact verification is `verified`, not skipped.
 *
 * The subprocess runs under tsx with the root tsconfig paths facade (src
 * mode) or under plain Node with type stripping (lib mode), exactly like the
 * S1 segment smoke fixtures. Exits 0 only when every schema assertion passed
 * and every expected result materialized.
 */

import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { validateJsonSchemaValue, valueSchemaSpecToJsonSchema } from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'
import {
  SEARCH_EVENTS,
  FIND_SIMILAR_STATES,
  FIND_COUNTERFACTUALS,
  ZOOM,
  dshPesResultFor,
  type PesResult,
} from '../../query.js'

const NAME = 'pes-driver'
const [configPath] = process.argv.slice(2)
if (configPath === undefined) {
  throw new Error(`${NAME}: expected <config-path>`)
}

const TOOLS = [SEARCH_EVENTS, FIND_SIMILAR_STATES, FIND_COUNTERFACTUALS, ZOOM]

const VALID_REQUESTS: Record<string, Record<string, unknown>> = {
  [SEARCH_EVENTS]: { query: 'cup acquisition', n: 2 },
  [FIND_SIMILAR_STATES]: { holding: ['cup'], n: 2 },
  [FIND_COUNTERFACTUALS]: { outcome: 'success', holding: ['cup'], n: 2 },
  [ZOOM]: { episode: 'u_TEST0001', t_start: 0, t_end: 14 },
}

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
const signal = new AbortController().signal
const results: PesResult[] = []

type PesTool = 'search_events' | 'find_similar_states' | 'find_counterfactuals' | 'zoom'

async function drive(ctx: Context, tool: PesTool, send: (ct: Context) => Promise<unknown>) {
  const run = async () => {
    const result = await send(ctx)
    if (typeof result === 'object' && result !== null && 'isError' in result && result.isError) {
      throw new Error(`${NAME}: ${tool} returned an error result`)
    }
    return result as { value: unknown }
  }
  const first = await run()
  const second = await run()
  if (JSON.stringify(second.value) !== JSON.stringify(first.value)) {
    throw new Error(`${NAME}: ${tool} was not deterministic across calls`)
  }
  const value = first.value as PesResult
  const violations = validateJsonSchemaValue(valueSchemaSpecToJsonSchema(dshPesResultFor(tool, value.mode)), value, 'result')
  if (violations.length > 0) {
    throw new Error(`${NAME}: ${tool} result violates the result schema: ${violations.join('; ')}`)
  }
  results.push(value)
  process.stdout.write(`${JSON.stringify({ event: 'result/ok', tool, value })}\n`)
}

try {
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  const registered = ctx.tools.schemas().map(schema => schema.name).sort()
  process.stdout.write(`${JSON.stringify({ event: 'tools', names: registered })}\n`)
  if (registered.length !== TOOLS.length || TOOLS.some(tool => !registered.includes(tool))) {
    throw new Error(`${NAME}: registered tools ${JSON.stringify(registered)} must be exactly [${TOOLS.join(', ')}]`)
  }

  // Tools with schema-required fields must reject an empty request; for
  // find_similar_states every field is optional at the schema level and the
  // "at least one state relation" rule is a plugin semantic check (covered by
  // the seam suite and the contract's structured-error path).
  const toolsWithRequiredFields = new Set<string>([SEARCH_EVENTS, FIND_COUNTERFACTUALS, ZOOM])
  for (const tool of TOOLS) {
    const schema = ctx.tools.schemas().find(entry => entry.name === tool)
    if (schema === undefined) throw new Error(`${NAME}: missing schema for ${tool}`)
    if (schema.parameters.type !== 'object') {
      throw new Error(`${NAME}: ${tool} parameters schema did not compile to an object root`)
    }
    const valid = validateJsonSchemaValue(schema.parameters, VALID_REQUESTS[tool]!, '')
    if (valid.length > 0) throw new Error(`${NAME}: ${tool} valid request was rejected: ${valid.join('; ')}`)
    if (toolsWithRequiredFields.has(tool)) {
      const missingRequired = validateJsonSchemaValue(schema.parameters, {}, '')
      if (missingRequired.length === 0) throw new Error(`${NAME}: ${tool} request missing required fields was accepted`)
    }
  }
  process.stdout.write(`${JSON.stringify({ event: 'schema', names: TOOLS.slice().sort(), valid: true })}\n`)

  await drive(ctx, SEARCH_EVENTS, ct => ct.tools.execute({
    signal, callId: CallId('pes-search'), name: SEARCH_EVENTS, arguments: VALID_REQUESTS[SEARCH_EVENTS]!,
  }))
  await drive(ctx, FIND_SIMILAR_STATES, ct => ct.tools.execute({
    signal, callId: CallId('pes-similar'), name: FIND_SIMILAR_STATES, arguments: VALID_REQUESTS[FIND_SIMILAR_STATES]!,
  }))
  await drive(ctx, FIND_COUNTERFACTUALS, ct => ct.tools.execute({
    signal, callId: CallId('pes-counterfactual'), name: FIND_COUNTERFACTUALS, arguments: VALID_REQUESTS[FIND_COUNTERFACTUALS]!,
  }))
  await drive(ctx, ZOOM, ct => ct.tools.execute({
    signal, callId: CallId('pes-zoom'), name: ZOOM, arguments: VALID_REQUESTS[ZOOM]!,
  }))

  // Cross-field semantic validation: both frames are schema-valid ints but
  // t_end < t_start — the plugin must surface a structured malformed-input
  // error result (not an isError and not a silent success).
  const malformed = await ctx.tools.execute({
    signal,
    callId: CallId('pes-zoom-malformed'),
    name: ZOOM,
    arguments: { episode: 'u_TEST0001', t_start: 10, t_end: 5 },
  })
  if (malformed.isError) throw new Error(`${NAME}: schema-valid but semantically invalid zoom should be a structured error result, not isError`)
  const malformedValue = malformed.value as unknown as PesResult
  if (malformedValue.status !== 'error' || malformedValue.error?.kind !== 'malformed-input') {
    throw new Error(`${NAME}: invalid zoom window did not surface as a structured malformed-input result`)
  }
  process.stdout.write(`${JSON.stringify({ event: 'result/error', tool: ZOOM, value: malformedValue })}\n`)

  const invalid = await ctx.tools.execute({
    signal,
    callId: CallId('pes-invalid'),
    name: SEARCH_EVENTS,
    arguments: {},
  })
  if (!invalid.isError) throw new Error(`${NAME}: input missing a required field was not rejected`)
  process.stdout.write(`${JSON.stringify({ event: 'result/invalid', name: SEARCH_EVENTS, isError: invalid.isError })}\n`)

  const phantom = await ctx.tools.execute({
    signal,
    callId: CallId('pes-phantom'),
    name: 'PHANTOM_TOOL',
    arguments: {},
  })
  if (!phantom.isError) throw new Error(`${NAME}: unknown tool name should surface as an error result`)
  process.stdout.write(`${JSON.stringify({ event: 'result/unknown', name: 'PHANTOM_TOOL', isError: phantom.isError })}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
