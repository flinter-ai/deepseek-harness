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
 * Automatic trace emission is proven end to end: the driver starts a
 * localhost receiver, points $PES_TRACE_* at it (callback + HMAC secret +
 * ancestry), and after driving the tools asserts exactly one CP searchable
 * trace record per DISTINCT completed result — canonical compact bytes in the
 * committed key order, HMAC-SHA256 `x-webhook-signature` over the exact body,
 * deterministic ids, and run ordinals 0..3. The identical second call of each
 * tool is deduplicated in-process (at-most-once), and the malformed/error and
 * registry-rejected calls emit nothing.
 *
 * The subprocess runs under tsx with the root tsconfig paths facade (src
 * mode) or under plain Node with type stripping (lib mode), exactly like the
 * S1 segment smoke fixtures. Exits 0 only when every schema assertion passed
 * and every expected result materialized.
 */

import { createHmac, createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

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
import {
  DEFAULT_PRODUCER_SHA,
  TRACE_RECORD_KEYS,
} from '../../trace-record.js'
import { SIGNATURE_HEADER } from '../../trace.js'

const NAME = 'pes-driver'
const [configPath] = process.argv.slice(2)
if (configPath === undefined) {
  throw new Error(`${NAME}: expected <config-path>`)
}

const TOOLS = [SEARCH_EVENTS, FIND_SIMILAR_STATES, FIND_COUNTERFACTUALS, ZOOM]

const TRACE_SECRET = 'dsh-pes-smoke-hmac-secret'
const TRACE_ORGANIZATION_ID = 'org-dsh-pes-smoke'
const TRACE_PROJECT_ID = 'proj-dsh-pes-smoke'
const TRACE_EPISODE_ID = 'ep-dsh-pes-smoke'
const TRACE_JOB_ID = 'job-dsh-pes-smoke'
const TRACE_IR_ID = 'ir-dsh-pes-smoke'
const TRACE_JOB_OUTPUT_ID = 'job-output-dsh-pes-smoke'
const TRACE_ARTIFACT_ID = 'artifact-dsh-pes-smoke'

interface CapturedTrace {
  method: string | undefined
  headers: Record<string, string | string[] | undefined>
  body: string
}

interface TraceReceiver {
  port: number
  records: CapturedTrace[]
  close: () => Promise<void>
}

/** Localhost HTTP receiver so the automatic emission can be proven without any control plane or network. */
async function startTraceReceiver(): Promise<TraceReceiver> {
  const records: CapturedTrace[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      body += chunk
    })
    req.on('end', () => {
      records.push({ method: req.method, headers: { ...req.headers }, body })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    })
    req.on('error', () => {
      res.writeHead(500)
      res.end()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return {
    port: address.port,
    records,
    close: () => new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    }),
  }
}

function assertTraceEmission(receiver: TraceReceiver): void {
  if (receiver.records.length !== TOOLS.length) {
    throw new Error(
      `${NAME}: expected exactly ${TOOLS.length} trace emissions (one per distinct completed result), got ${receiver.records.length}`,
    )
  }
  receiver.records.forEach((record, index) => {
    if (record.method !== 'POST') {
      throw new Error(`${NAME}: trace record ${index} used method ${String(record.method)} instead of POST`)
    }
    const signature = record.headers[SIGNATURE_HEADER]
    if (typeof signature !== 'string' || signature === '') {
      throw new Error(`${NAME}: trace record ${index} is missing the ${SIGNATURE_HEADER} header`)
    }
    const expectedSignature = createHmac('sha256', TRACE_SECRET).update(record.body).digest('hex')
    if (signature !== expectedSignature) {
      throw new Error(`${NAME}: trace record ${index} signature is not HMAC-SHA256 of the exact body bytes`)
    }
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(record.body) as Record<string, unknown>
    } catch {
      throw new Error(`${NAME}: trace record ${index} body is not JSON`)
    }
    if (JSON.stringify(parsed) !== record.body) {
      throw new Error(`${NAME}: trace record ${index} body is not canonical compact JSON`)
    }
    if (Object.keys(parsed).join(',') !== TRACE_RECORD_KEYS.join(',')) {
      throw new Error(`${NAME}: trace record ${index} key order deviates from the committed canonical order`)
    }
    const tool = TOOLS[index]
    if (parsed.traceKind !== tool) {
      throw new Error(`${NAME}: trace record ${index} traceKind ${String(parsed.traceKind)} does not match tool ${tool}`)
    }
    if (parsed.runOrdinal !== index) {
      throw new Error(`${NAME}: trace record ${index} runOrdinal ${String(parsed.runOrdinal)} is not the deterministic ${index}`)
    }
    if (parsed.organizationId !== TRACE_ORGANIZATION_ID
      || parsed.projectId !== TRACE_PROJECT_ID
      || parsed.episodeId !== TRACE_EPISODE_ID
      || parsed.jobId !== TRACE_JOB_ID
      || parsed.irId !== TRACE_IR_ID
      || parsed.jobOutputId !== TRACE_JOB_OUTPUT_ID
      || parsed.artifactId !== TRACE_ARTIFACT_ID) {
      throw new Error(`${NAME}: trace record ${index} ancestry fields do not match the configured runtime context`)
    }
    if (parsed.producerSha !== DEFAULT_PRODUCER_SHA) {
      throw new Error(`${NAME}: trace record ${index} producerSha is not the engine commit`)
    }
    if (parsed.schemaVersion !== '1') {
      throw new Error(`${NAME}: trace record ${index} schemaVersion is not the committed numeric string`)
    }
    if (typeof parsed.id !== 'string' || !/^tr_[0-9a-f]{24}$/.test(parsed.id)) {
      throw new Error(`${NAME}: trace record ${index} id is not the deterministic derived id`)
    }
    const derived = `tr_${createHash('sha256')
      .update(`${TRACE_ORGANIZATION_ID}:${TRACE_IR_ID}:${index}`)
      .digest('hex')
      .slice(0, 24)}`
    if (parsed.id !== derived) {
      throw new Error(`${NAME}: trace record ${index} id ${parsed.id} deviates from the derived ${derived}`)
    }
  })
}

const VALID_REQUESTS: Record<string, Record<string, unknown>> = {
  [SEARCH_EVENTS]: { query: 'cup acquisition', n: 2 },
  [FIND_SIMILAR_STATES]: { holding: ['cup'], n: 2 },
  [FIND_COUNTERFACTUALS]: { outcome: 'success', holding: ['cup'], n: 2 },
  [ZOOM]: { episode: 'u_TEST0001', t_start: 0, t_end: 14 },
}

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
let receiver: TraceReceiver | undefined
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
  // Runtime-owned trace transport: a localhost receiver plus a fixed test
  // secret, wired ONLY through the PES_TRACE_* environment the plugin reads at
  // load — no tool/model field can select the destination.
  receiver = await startTraceReceiver()
  process.env.PES_TRACE_CALLBACK_URL = `http://127.0.0.1:${receiver.port}/webhooks/dsh-worker/trace`
  process.env.PES_TRACE_HMAC_SECRET = TRACE_SECRET
  process.env.PES_TRACE_ORGANIZATION_ID = TRACE_ORGANIZATION_ID
  process.env.PES_TRACE_PROJECT_ID = TRACE_PROJECT_ID
  process.env.PES_TRACE_EPISODE_ID = TRACE_EPISODE_ID
  process.env.PES_TRACE_JOB_ID = TRACE_JOB_ID
  process.env.PES_TRACE_IR_ID = TRACE_IR_ID
  process.env.PES_TRACE_JOB_OUTPUT_ID = TRACE_JOB_OUTPUT_ID
  process.env.PES_TRACE_ARTIFACT_ID = TRACE_ARTIFACT_ID
  process.env.PES_TRACE_RUN_ORDINAL_BASE = '0'

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

  // Automatic emission: exactly one record per distinct completed result
  // (search, similar, counterfactual, zoom), canonical bytes + HMAC, run
  // ordinals 0..3; the malformed/error and registry-rejected calls emitted
  // nothing and the identical repeat calls were deduplicated (at-most-once).
  assertTraceEmission(receiver)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  if (receiver !== undefined) await receiver.close()
  uninstallFailLoud()
}
