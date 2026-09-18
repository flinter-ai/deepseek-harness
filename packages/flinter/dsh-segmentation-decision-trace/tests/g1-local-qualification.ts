import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as decisionTrace from '@deepseek-ai/dsh-decision-trace'
import type {
  DecisionStatus,
  Disposition,
} from '@deepseek-ai/dsh-decision-trace'
import { HarnessError, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, {
  defineTool,
  type ToolDefinition,
} from '@deepseek-ai/dsh-tools'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import * as segmentationTrace from '../src/index.ts'
import type {
  SegmentationDecisionRequest,
  SegmentationDecisionSource,
} from '../src/types.ts'

const TOOL_NAME = 'segment.qualify'
const SESSION_ID = 'g1-main-authored'
const SCOPE = 'local-runtime-fixture'
const DEFAULT_OUTPUT = resolve(tmpdir(), 'dsh-g1-capture.json')
type Stimulus = 'return' | 'provider-error'
export interface G1CaseInput {
  readonly case_id: string
  readonly stimulus: Stimulus
  readonly input: {
    readonly candidate_ref: string
    readonly allowed_actions: readonly string[]
    readonly chosen_action: string
    readonly requested_evidence_refs: readonly string[]
    readonly fetched_evidence_refs: readonly string[]
    readonly displayed_evidence_refs: readonly string[]
    readonly budget_before: number | null
  }
}
export interface G1TestData {
  readonly cases: readonly G1CaseInput[]
}
export interface G1ToolResultSummary {
  readonly sessionId: string
  readonly caseId: string
  readonly callId: string
  readonly isError: boolean
  readonly value?: unknown
  readonly errorCode?: string
  readonly errorName?: string
}
export interface G1CaptureOutput {
  readonly schema: 'flinter.g1-session-events.v1'
  readonly scope: typeof SCOPE
  readonly provenance: {
    readonly harness: string
    readonly node: string
    readonly inputPath?: string
    readonly inputSha256?: string
    readonly persistence: 'jsonl-reloaded'
    readonly provider: 'local-deterministic-tool-only'
    readonly rootMode: 'external' | 'temp'
  }
  readonly events: readonly SessionEvent[]
  readonly toolResults: readonly G1ToolResultSummary[]
  readonly persistenceAck: boolean
  readonly reloadEquality: {
    readonly equal: boolean
    readonly liveCount: number
    readonly reloadedCount: number
    readonly liveDigest: string
    readonly reloadedDigest: string
  }
  readonly diagnostics: readonly string[]
  readonly session: {
    readonly sessionId: string
    readonly header: SessionHeader
    readonly events: readonly SessionEvent[]
  }
  readonly rawArtifact: { readonly digest: string; readonly byteCount: number }
}
interface Plan {
  readonly caseId: string
  readonly callId: string
  readonly stimulus: Stimulus
  readonly request: SegmentationDecisionRequest
}
class FixtureToolError extends HarnessError {
  constructor() {
    super('controlled local fixture tool error', 'FIXTURE_TOOL_ERROR')
  }
}
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const digest = (events: readonly SessionEvent[]) =>
  createHash('sha256').update(JSON.stringify(events)).digest('hex')
export function parseTestData(value: unknown): G1TestData {
  if (!isRecord(value) || !Array.isArray(value.cases)) {
    throw new TypeError('G1 input must contain a cases array')
  }
  return {
    cases: value.cases.map((item) => {
      if (
        !isRecord(item) || typeof item.case_id !== 'string' ||
        (item.stimulus !== 'return' && item.stimulus !== 'provider-error') ||
        !isRecord(item.input)
      ) throw new TypeError('G1 input contains an invalid case')
      const i = item.input
      const arrays = [
        'allowed_actions',
        'requested_evidence_refs',
        'fetched_evidence_refs',
        'displayed_evidence_refs',
      ]
      if (
        typeof i.candidate_ref !== 'string' ||
        typeof i.chosen_action !== 'string' || !arrays.every(k =>
          Array.isArray(i[k]) && i[k].every(v =>
            typeof v === 'string',
          ),
        ) || (i.budget_before !== null && typeof i.budget_before !== 'number')
      ) throw new TypeError(`G1 input case ${item.case_id} has invalid fields`)
      return {
        case_id: item.case_id,
        stimulus: item.stimulus,
        input: {
          candidate_ref: i.candidate_ref,
          allowed_actions: i.allowed_actions as string[],
          chosen_action: i.chosen_action,
          requested_evidence_refs: i.requested_evidence_refs as string[],
          fetched_evidence_refs: i.fetched_evidence_refs as string[],
          displayed_evidence_refs: i.displayed_evidence_refs as string[],
          budget_before: i.budget_before as number | null,
        },
      }
    }) as G1CaseInput[],
  }
}
function defaultCases(): G1CaseInput[] {
  const base = {
    allowed_actions: ['action:segment.keep'],
    chosen_action: 'action:segment.keep',
    requested_evidence_refs: ['evidence:requested'],
    fetched_evidence_refs: ['evidence:fetched'],
    displayed_evidence_refs: ['evidence:displayed'],
    budget_before: 7,
  }
  return [{
    case_id: 'case-01',
    stimulus: 'return',
    input: { ...base, candidate_ref: 'candidate:success' },
  }, {
    case_id: 'case-02',
    stimulus: 'provider-error',
    input: { ...base, candidate_ref: 'candidate:failure' },
  }]
}
function plans(cases: readonly G1CaseInput[]): Plan[] {
  return cases.map((c, i) => ({
    caseId: c.case_id,
    callId: `call-${String(i + 1).padStart(2, '0')}`,
    stimulus: c.stimulus,
    request: {
      allowedActions: c.input.allowed_actions,
      chosenAction: c.input.chosen_action,
      requestedEvidenceRefs: c.input.requested_evidence_refs,
      fetchedEvidenceRefs: c.input.fetched_evidence_refs,
      displayedEvidenceRefs: c.input.displayed_evidence_refs,
      budgetBefore: c.input.budget_before,
      candidateRefs: [c.input.candidate_ref],
      lineageRefs: [],
      sourceRef: 'source:local-g1',
      modelRef: 'model:deterministic-fixture',
      policyRevisionRef: 'policy:g1-baseline',
    },
  }))
}
function tool(map: ReadonlyMap<string, Plan>): ToolDefinition {
  return defineTool({
    name: TOOL_NAME,
    description: 'Two-call deterministic fixture',
    parameters: { callId: { type: 'string', required: true } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          outcome: { type: 'string', required: true },
          disposition: { type: 'string', required: true },
          caseId: { type: 'string', required: true },
        },
      },
      render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }],
    },
    async execute(args) {
      const p = map.get(args.callId)
      if (!p) throw new Error('unknown local qualification call')
      if (p.stimulus === 'provider-error') throw new FixtureToolError()
      return { outcome: 'success', disposition: 'retained', caseId: p.caseId }
    },
  })
}
function source(map: ReadonlyMap<string, Plan>): SegmentationDecisionSource {
  return {
    request: (exec) => {
      const p = map.get(String(exec.callId))
      if (!p) throw new Error('unknown call')
      return p.request
    },
    result: (_exec, result) => {
      if (result.isError) {
        return result.error?.info?.code === 'FIXTURE_TOOL_ERROR'
          ? { outcome: 'provider-error', disposition: 'unknown' }
          : { outcome: 'unknown', disposition: 'unknown' }
      }
      if (!isRecord(result.value)) {
        return { outcome: 'unknown', disposition: 'unknown' }
      }
      return {
        outcome: result.value.outcome === 'success'
          ? 'success' as DecisionStatus
          : 'unknown',
        disposition: result.value.disposition === 'retained'
          ? 'retained' as Disposition
          : 'unknown',
      }
    },
  }
}
async function context(root: string, sessionId: string, ps: readonly Plan[]) {
  const ctx = new Context()
  await ctx.plugin(JsonlSessionPersistence, {
    root,
    compression: 'none',
    packChunks: false,
  })
  await ctx.plugin(SessionStore)
  if (!ps.length) {
    return {
      ctx,
      session: undefined,
      agent: undefined,
      dispose: () => ctx.fiber.dispose(),
    }
  }
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const byCall = new Map(ps.map(p => [p.callId, p]))
  ctx.tools.register(tool(byCall))
  await ctx.plugin(decisionTrace)
  await ctx.plugin(segmentationTrace, {
    toolName: TOOL_NAME,
    source: source(byCall),
  })
  const session = ctx.sessions.create(SessionId(sessionId), {
    meta: { cwd: '/tmp/dsh-g1-local-qualification' },
  })
  return {
    ctx,
    session,
    agent: { id: session.id, session } as unknown as Agent,
    dispose: () => ctx.fiber.dispose(),
  }
}
async function run(cases: readonly G1CaseInput[], root: string) {
  const ps = plans(cases)
  const h = await context(root, SESSION_ID, ps)
  const results: G1ToolResultSummary[] = []
  try {
    for (const p of ps) {
      const r = await h.ctx.tools.execute({
        signal: new AbortController().signal,
        callId: ToolCallId(p.callId),
        name: TOOL_NAME,
        arguments: { callId: p.callId },
        agent: h.agent,
      })
      results.push(
        r.isError
          ? {
            sessionId: SESSION_ID,
            caseId: p.caseId,
            callId: p.callId,
            isError: true,
            ...(typeof r.error.info?.code === 'string'
              ? { errorCode: r.error.info.code }
              : {}),
            ...(typeof r.error.info?.name === 'string'
              ? { errorName: r.error.info.name }
              : {}),
          }
          : {
            sessionId: SESSION_ID,
            caseId: p.caseId,
            callId: p.callId,
            isError: false,
            value: r.value,
          },
      )
    }
    const ack = await h.ctx.sessions.flush(h.session!)
    const raw = await h.ctx.sessionPersistence.readRaw(SessionId(SESSION_ID))
    if (!raw) throw new Error('missing physical session artifact')
    const live = [...h.session!.events]
    const diagnostics = [...h.ctx.flinterDecisionTrace.diagnostics]
    await h.dispose()
    const reopened = await context(root, SESSION_ID, [])
    try {
      const loaded = await reopened.ctx.sessionPersistence.load(
        SessionId(SESSION_ID),
      )
      return { ps, live, loaded, results, ack, diagnostics, raw }
    } finally {
      await reopened.dispose()
    }
  } catch (e) {
    await h.dispose()
    throw e
  }
}
export async function runG1Capture(
  options: {
    readonly input?: G1TestData
    readonly outputPath?: string
    readonly inputPath?: string
    readonly persistenceRoot?: string
  } = {},
): Promise<G1CaptureOutput> {
  const input = options.input ?? { cases: defaultCases() }
  if (input.cases.length !== 2) {
    throw new TypeError('G1 local checkpoint requires exactly two cases')
  }
  const external = options.persistenceRoot ?? process.env.G1_PERSISTENCE_ROOT
  const root = external
    ? resolve(external)
    : await mkdtemp(resolve(tmpdir(), 'dsh-g1-capture-'))
  if (external) {
    try {
      if ((await stat(root)).isDirectory()) {
        throw new Error(
          'G1_PERSISTENCE_ROOT already exists; refusing append/conflict',
        )
      }
    } catch (e: unknown) {
      if (!isRecord(e) || e.code !== 'ENOENT') throw e
    }
    await mkdir(root, { recursive: true })
  }
  try {
    const r = await run(input.cases, root)
    const equal = JSON.stringify(r.live) === JSON.stringify(r.loaded.events)
    if (!equal) throw new Error('live and reloaded events differ')
    const inputSha256 = options.inputPath
      ? createHash('sha256').update(await readFile(options.inputPath, 'utf8'))
        .digest('hex')
      : undefined
    const out: G1CaptureOutput = {
      schema: 'flinter.g1-session-events.v1',
      scope: SCOPE,
      provenance: {
        harness:
          'dsh-segmentation-decision-trace/tests/g1-local-qualification.ts',
        node: process.version,
        ...(options.inputPath
          ? { inputPath: resolve(options.inputPath), inputSha256 }
          : {}),
        persistence: 'jsonl-reloaded',
        provider: 'local-deterministic-tool-only',
        rootMode: external ? 'external' : 'temp',
      },
      events: r.loaded.events,
      toolResults: r.results,
      persistenceAck: r.ack,
      reloadEquality: {
        equal,
        liveCount: r.live.length,
        reloadedCount: r.loaded.events.length,
        liveDigest: digest(r.live),
        reloadedDigest: digest(r.loaded.events),
      },
      diagnostics: r.diagnostics,
      session: {
        sessionId: SESSION_ID,
        header: r.loaded.meta,
        events: r.loaded.events,
      },
      rawArtifact: {
        digest: createHash('sha256').update(r.raw.content).digest('hex'),
        byteCount: Buffer.byteLength(r.raw.content),
      },
    }
    const path = options.outputPath ?? process.env.G1_CAPTURE_OUTPUT ??
      DEFAULT_OUTPUT
    if (!isAbsolute(path)) {
      throw new TypeError('G1_CAPTURE_OUTPUT must be an absolute path')
    }
    await mkdir(dirname(path), { recursive: true })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path, `${JSON.stringify(out, null, 2)}\n`)
    return out
  } finally {
    if (!external) await rm(root, { recursive: true, force: true })
  }
}
export async function runG1Reload(
  options: {
    readonly inputPath: string
    readonly persistenceRoot: string
    readonly outputPath: string
  },
): Promise<unknown> {
  const inputSha256 = createHash('sha256').update(
    await readFile(options.inputPath, 'utf8'),
  ).digest('hex')
  const h = await context(resolve(options.persistenceRoot), SESSION_ID, [])
  try {
    const loaded = await h.ctx.sessionPersistence.load(SessionId(SESSION_ID))
    const out = {
      schema: 'flinter.g1-process-reload-proof.v1',
      inputSha256,
      sessionId: SESSION_ID,
      durableEventCount: loaded.events.length,
      durableEventDigest: digest(loaded.events),
      events: loaded.events,
      session: {
        sessionId: SESSION_ID,
        header: loaded.meta,
        events: loaded.events,
      },
    }
    const { writeFile } = await import('node:fs/promises')
    await mkdir(dirname(options.outputPath), { recursive: true })
    await writeFile(options.outputPath, `${JSON.stringify(out, null, 2)}\n`)
    return out
  } finally {
    await h.dispose()
  }
}
async function main() {
  const inputPath = process.env.G1_CAPTURE_INPUT
  const outputPath = process.env.G1_CAPTURE_OUTPUT ?? DEFAULT_OUTPUT
  if (process.env.G1_CAPTURE_MODE === 'reload') {
    if (!process.env.G1_PERSISTENCE_ROOT || !inputPath) {
      throw new TypeError(
        'reload mode requires G1_PERSISTENCE_ROOT and G1_CAPTURE_INPUT',
      )
    }
    const out = await runG1Reload({
      inputPath,
      persistenceRoot: process.env.G1_PERSISTENCE_ROOT,
      outputPath,
    })
    process.stdout.write(`${JSON.stringify({ outputPath, ...out })}\n`)
    return
  }
  const out = await runG1Capture({
    input: inputPath
      ? parseTestData(JSON.parse(await readFile(inputPath, 'utf8')))
      : undefined,
    inputPath,
    outputPath,
    persistenceRoot: process.env.G1_PERSISTENCE_ROOT,
  })
  process.stdout.write(
    `${
      JSON.stringify({
        outputPath,
        eventCount: out.events.length,
        persistenceAck: out.persistenceAck,
        reloadEquality: out.reloadEquality,
      })
    }\n`,
  )
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)
) await main()
