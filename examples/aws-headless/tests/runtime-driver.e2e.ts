/**
 * Keyless process test for the aws-headless runtime semantic/trace E2E
 * driver (`runtime-driver.js`): runs the driver as a subprocess against the
 * REAL assembled aws-headless profile materialized into the smoke's DSH_HOME,
 * with a localhost callback receiver and a deterministic engine command
 * (the protocol-compatible stub selected by $PES_QUERY_COMMAND — production
 * never falls back to a fixture; an unusable engine is a structured failure).
 *
 * The happy path asserts the driver's ONE bounded machine-readable summary
 * and the automatic trace emission end to end: exactly one canonical CP
 * searchable-trace record POSTed to the receiver with the
 * `x-webhook-signature` HMAC-SHA256 header over the exact body, the pinned
 * producer SHA in provenance and on the record, and a clean exit. The failure
 * suite pins the designed nonzero exits: missing corpus (2), engine failure
 * (3), abstention (4), malformed provenance via an unpinned profile fixture
 * (5), and trace transport failure via a 500 receiver (6).
 */

import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { materializeProfile } from './profile.ts'

const driverBin = fileURLToPath(new URL('../runtime-driver.js', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const stubEngine = fileURLToPath(new URL('../../dsh-pes/tests/fixtures/stub-engine.mjs', import.meta.url))
const failingEngine = fileURLToPath(new URL('../../dsh-pes/tests/fixtures/failing-engine.mjs', import.meta.url))
const abstainEngine = fileURLToPath(new URL('./fixtures/abstain-engine.mjs', import.meta.url))
const eventsPath = fileURLToPath(new URL('../../dsh-pes/tests/fixtures/events.jsonl', import.meta.url))
const artifactsRoot = fileURLToPath(new URL('../../dsh-pes/tests/fixtures', import.meta.url))

const ENGINE_PIN = 'c05c3fc747f0aa0fcb9d0603009add71c59e091b'
const TRACE_SECRET = 'aws-headless-runtime-driver-hmac-secret'
const TRACE_CONTEXT = {
  organizationId: 'org-aws-headless-runtime',
  projectId: 'proj-aws-headless-runtime',
  episodeId: 'ep-aws-headless-runtime',
  jobId: 'job-aws-headless-runtime',
  irId: 'ir-aws-headless-runtime',
  jobOutputId: 'jo-aws-headless-runtime',
  artifactId: 'art-aws-headless-runtime',
}

/** The driver's one bounded machine-readable summary envelope. */
interface RuntimeDriverSummary {
  driver: string
  schema: string
  kind: string
  scientific_proof: boolean
  profile: string
  status?: string
  reason?: string
  exit_code: number
  baseline_physics?: {
    status: string
    abstention: string
    interface_check_only: boolean
  }
  search_events?: {
    status: string
    abstained: boolean
    count: number
    requested_n: number
    bounded: boolean
    artifact_verification: string
    engine_pin: string
    event_ids: string[]
  }
  trace_emission?: {
    configured: boolean
    status?: string
    record_id?: string
  }
}

/** The committed CP searchable-trace wire record, as asserted on the receiver. */
interface TraceRecordPayload {
  organizationId: string
  projectId: string
  episodeId: string
  jobId: string
  irId: string
  jobOutputId: string
  artifactId: string
  runOrdinal: number
  traceKind: string
  producerSha: string
  schemaVersion: string
  id: string
}

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

/** Localhost callback receiver so the automatic emission is provable without any control plane or network. */
async function startTraceReceiver(status = 200): Promise<TraceReceiver> {
  const records: CapturedTrace[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      records.push({ method: req.method, headers: { ...req.headers }, body })
      res.writeHead(status, { 'content-type': 'application/json' })
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

function traceEnv(receiver: TraceReceiver): Record<string, string> {
  return {
    PES_TRACE_CALLBACK_URL: `http://127.0.0.1:${receiver.port}/webhooks/dsh-worker/trace`,
    PES_TRACE_HMAC_SECRET: TRACE_SECRET,
    PES_TRACE_ORGANIZATION_ID: TRACE_CONTEXT.organizationId,
    PES_TRACE_PROJECT_ID: TRACE_CONTEXT.projectId,
    PES_TRACE_EPISODE_ID: TRACE_CONTEXT.episodeId,
    PES_TRACE_JOB_ID: TRACE_CONTEXT.jobId,
    PES_TRACE_IR_ID: TRACE_CONTEXT.irId,
    PES_TRACE_JOB_OUTPUT_ID: TRACE_CONTEXT.jobOutputId,
    PES_TRACE_ARTIFACT_ID: TRACE_CONTEXT.artifactId,
    PES_TRACE_RUN_ORDINAL_BASE: '0',
  }
}

describe('aws-headless runtime semantic/trace E2E driver', () => {
  it('boots the real assembled profile and drives RUN_BASELINE_PHYSICS + search_events with automatic trace emission (pass)', async () => {
    const receiver = await startTraceReceiver(200)
    try {
      const { stdout, stderr } = await runLoaderSmoke({
        label: 'aws-headless-runtime-driver',
        tempDirPrefix: 'aws-headless-runtime-pass-',
        binScript: driverBin,
        libBinScript: driverBin,
        configPath: driverBin,
        binArgs: ['aws-headless'],
        tsconfigPath,
        prepare: async (cwd) => { await materializeProfile(join(cwd, '.dsh')) },
        env: {
          AWS_EC2_METADATA_DISABLED: 'true',
          PES_QUERY_COMMAND: JSON.stringify([process.execPath, stubEngine]),
          PES_EVENTS_ENRICHED_JSONL: eventsPath,
          PES_ARTIFACTS_ROOT: artifactsRoot,
          PES_SEARCH_QUERY: 'cup acquisition',
          ...traceEnv(receiver),
        },
      })
      expect(stderr).toBe('')
      const lines = stdout.trimEnd().split('\n')
      expect(lines).toHaveLength(1)
      const summary = JSON.parse(lines[0]!) as RuntimeDriverSummary
      expect(summary).toMatchObject({
        driver: 'aws-headless-runtime-driver',
        kind: 'runtime-semantic-trace-e2e',
        scientific_proof: false,
        profile: 'aws-headless',
        baseline_physics: {
          status: 'completed',
          abstention: 'prototype_stub',
          interface_check_only: true,
        },
        search_events: {
          status: 'completed',
          abstained: false,
          bounded: true,
          artifact_verification: 'verified',
          engine_pin: ENGINE_PIN,
        },
        trace_emission: { configured: true, status: 'accepted' },
        exit_code: 0,
      })
      const search = summary.search_events!
      expect(search.count).toBeGreaterThan(0)
      expect(search.count).toBeLessThanOrEqual(search.requested_n)

      // Automatic emission: exactly one canonical record, signed with the CP
      // webhook-verify header convention over the exact bytes.
      expect(receiver.records).toHaveLength(1)
      const record = receiver.records[0]!
      expect(record.method).toBe('POST')
      const signature = record.headers['x-webhook-signature']
      expect(typeof signature).toBe('string')
      expect(signature).toBe(createHmac('sha256', TRACE_SECRET).update(record.body).digest('hex'))
      const parsed = JSON.parse(record.body) as TraceRecordPayload
      expect(parsed.traceKind).toBe('search_events')
      expect(parsed.producerSha).toBe(ENGINE_PIN)
      expect(parsed.schemaVersion).toBe('1')
      expect(parsed.runOrdinal).toBe(0)
      for (const [key, value] of Object.entries(TRACE_CONTEXT)) {
        expect(parsed[key as keyof TraceRecordPayload]).toBe(value)
      }
      expect(parsed.id).toMatch(/^tr_[0-9a-f]{24}$/)
    } finally {
      await receiver.close()
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('exits nonzero per failure class with a bounded machine-readable summary (failure classification)', async () => {
    interface FailureCase {
      name: string
      expectedExit: number
      env?: Record<string, string>
      enginePin?: boolean
      reason?: RegExp
    }

    const missingCorpusReceiver = await startTraceReceiver(200)
    const traceFailureReceiver = await startTraceReceiver(500)
    try {
      const cases: FailureCase[] = [
        {
          name: 'missing-corpus',
          expectedExit: 2,
          // No PES_EVENTS_ENRICHED_JSONL: the driver must fail fast, never
          // guess a corpus and never fall back to a fixture corpus.
          env: { PES_QUERY_COMMAND: JSON.stringify([process.execPath, stubEngine]) },
          reason: /events index/,
        },
        {
          name: 'engine-failure',
          expectedExit: 3,
          env: {
            PES_QUERY_COMMAND: JSON.stringify([process.execPath, failingEngine, '--exit', '1']),
            PES_EVENTS_ENRICHED_JSONL: eventsPath,
          },
          reason: /engine/,
        },
        {
          name: 'abstention',
          expectedExit: 4,
          env: {
            PES_QUERY_COMMAND: JSON.stringify([process.execPath, abstainEngine]),
            PES_EVENTS_ENRICHED_JSONL: eventsPath,
          },
          reason: /abstained/,
        },
        {
          name: 'malformed-provenance',
          expectedExit: 5,
          enginePin: false,
          env: {
            PES_QUERY_COMMAND: JSON.stringify([process.execPath, stubEngine]),
            PES_EVENTS_ENRICHED_JSONL: eventsPath,
          },
          reason: /provenance/,
        },
        {
          name: 'trace-transport-failure',
          expectedExit: 6,
          env: {
            PES_QUERY_COMMAND: JSON.stringify([process.execPath, stubEngine]),
            PES_EVENTS_ENRICHED_JSONL: eventsPath,
            ...traceEnv(traceFailureReceiver),
          },
          reason: /accepted/,
        },
      ]

      for (const failure of cases) {
        const { stdout } = await runLoaderSmoke({
          label: `aws-headless-runtime-driver-${failure.name}`,
          tempDirPrefix: `aws-headless-runtime-${failure.name}-`,
          binScript: driverBin,
          libBinScript: driverBin,
          configPath: driverBin,
          binArgs: ['aws-headless'],
          tsconfigPath,
          expectedExitCode: failure.expectedExit,
          prepare: async (cwd) => {
            await materializeProfile(join(cwd, '.dsh'), failure.enginePin === undefined ? {} : { enginePin: failure.enginePin })
          },
          env: {
            AWS_EC2_METADATA_DISABLED: 'true',
            PES_SEARCH_QUERY: 'cup acquisition',
            ...failure.env,
          },
        })
        const lines = stdout.trimEnd().split('\n')
        expect(lines, failure.name).toHaveLength(1)
        const summary = JSON.parse(lines[0]!) as RuntimeDriverSummary
        expect(summary.status, failure.name).toBe('fail')
        expect(summary.exit_code, failure.name).toBe(failure.expectedExit)
        expect(summary.kind, failure.name).toBe('runtime-semantic-trace-e2e')
        if (failure.reason !== undefined) expect(summary.reason, failure.name).toMatch(failure.reason)
      }
    } finally {
      await missingCorpusReceiver.close()
      await traceFailureReceiver.close()
    }
  }, 300_000)
})
