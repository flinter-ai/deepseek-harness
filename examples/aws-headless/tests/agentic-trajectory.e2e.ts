/**
 * P0.6 acceptance: one AWS-headless candidate trajectory through the composed
 * profile — boot, privileged investigation start, a replayed
 * `run_physical_assessment` macro-action, and a terminal
 * `finish_investigation`, with every transition reconstructable from the
 * session log. Keyless: the model is the llm-replay waterfall and the AWS
 * environment is stripped.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { boot, healProfilesModuleFallback, loadProfile } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type {} from '@deepseek-ai/dsh-agent'
import { foldInvestigations } from '@deepseek-ai/dsh-agentic-control'
import type {} from '@deepseek-ai/dsh-agentic-control'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import type {} from '@deepseek-ai/dsh-tools'
import { INSTALL_ANCHOR, REPO_ROOT, linkProfilePackage, materializeProfile, sanitizeAwsEnv } from './profile.ts'

const ORCA_TOOL_NAMES = ['worker_done', 'orca_check_inbox', 'orca_ask', 'orca_heartbeat', 'agentbox_launch']

/** The replayed model script: assess, then finish (which concludes the turn). */
const REPLAY_SCRIPT = [
  {
    kind: 'chunks',
    chunks: [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      {
        type: 'tool-call-delta',
        index: 0,
        id: 'call_assess',
        name: 'run_physical_assessment',
        argumentsDelta: '{}',
      },
      {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id: 'call_assess', name: 'run_physical_assessment', arguments: '{}' },
      },
      { type: 'usage', usage: { inputTokens: 40, outputTokens: 6 } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ],
  },
  {
    kind: 'chunks',
    chunks: [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      {
        type: 'tool-call-delta',
        index: 0,
        id: 'call_finish',
        name: 'finish_investigation',
        argumentsDelta: '{}',
      },
      {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id: 'call_finish', name: 'finish_investigation', arguments: '{}' },
      },
      { type: 'usage', usage: { inputTokens: 60, outputTokens: 5 } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ],
  },
]

describe('aws-headless agentic-control trajectory', () => {
  it('runs one candidate investigation to a logged finish through the composed profile', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-aws-agentic-'))
    const restoreEnv = sanitizeAwsEnv(home)
    try {
      const profileDir = await materializeProfile(home)
      // The replay adapter is a test-only package outside the shipped
      // composition; link it like the profile's installed packages.
      await linkProfilePackage(
        profileDir, '@deepseek-ai', 'dsh-llm-replay', join(REPO_ROOT, 'packages/test-support/llm-replay'),
      )
      const overrideFile = join(home, 'replay.override.json')
      await writeFile(overrideFile, `${JSON.stringify(REPLAY_SCRIPT)}\n`)

      healProfilesModuleFallback(INSTALL_ANCHOR, home)
      const profile = loadProfile('dsh-test', 'aws-headless', INSTALL_ANCHOR, home)
      const patches: PatchOptions[] = [
        ...profile.layers.flatMap(layer => layer.patches),
        ...profile.patches,
        { id: 'settings', config: { path: join(home, 'settings.yaml'), watch: false } },
        { id: 'session-telemetry-otel', disabled: true },
        { id: 'llm-deepseek', disabled: true },
        // The title provider issues its own model call through the same
        // replay waterfall; keep the two scripted entries for the turn.
        { id: 'session-title-llm', disabled: true },
        {
          id: 'agent-loop',
          config: {
            agents: [{ id: 'main', provider: 'deepseek-official', model: 'deepseek-v4-flash', cwd: process.cwd() }],
          },
        },
        {
          insert: [
            {
              id: 'llm-replay',
              name: '@deepseek-ai/dsh-llm-replay',
              // `file` never exists: the bare-entry override replaces the
              // derived script, and a missing log yields the default header.
              config: { file: join(home, 'unused-session.jsonl'), overrideFile },
            },
          ],
        },
      ]
      const ctx = await boot('dsh-test', join(profileDir, 'cordis.yml'), patches, (bootCtx) => {
        provideCmdline(bootCtx, { args: [], exit: () => {} })
      })
      try {
        const roots = ctx.agents.roots()
        expect(roots).toHaveLength(1)
        const agent = roots[0]
        if (agent === undefined) throw new Error('expected the configured root agent')

        // The privileged channel starts the investigation; the model never can.
        const started = ctx.investigations.start(agent, {
          candidateId: 'C17',
          actionFamily: 'pick-place',
          window: 't=10..20',
          requirements: ['physical assessment'],
        })
        expect(started).toMatchObject({ revision: 1, phase: 'active', lineage: 'unknown' })

        const turn = await runFixtureTurn(ctx, { task: 'Investigate candidate C17.' })

        // Every transition is durable and ordered: start, assess, finish.
        const changes = agent.session.events.filter(event => event.type === 'investigation/change')
        expect(changes.map(event => event.data.operation)).toEqual(['start', 'assess', 'finish'])

        // The strict replay fold reconstructs exactly the live service view.
        const folded = foldInvestigations(agent.session.events)
        expect(folded).toMatchObject({
          revision: 3,
          phase: 'finished',
          lineage: 'attached',
          physical: {
            handObservation: 'valid',
            traceQuality: 'reliable',
            hoiSupport: 'positive',
            objectTraceQuality: 'reliable',
          },
          evidence: { requirements: ['physical assessment'], currentStatus: 'satisfied' },
          budget: { maxAttempts: 3, usedAttempts: 1 },
        })
        expect(folded?.attempts).toHaveLength(1)
        expect(folded?.attempts[0]).toMatchObject({
          action: 'run_physical_assessment',
          provider: 'stub',
          outcome: 'completed',
          provenance: 'stub',
        })
        expect(ctx.investigations.get(agent)).toEqual(folded)

        // The authoritative projection entered model-visible history as
        // durable, source-attributed messages: revision 1 before the first
        // step, revision 2 after the assessment.
        const projections = agent.session.events.filter(event =>
          event.type === 'user/message'
          && event.data.source.kind === 'plugin'
          && event.data.source.plugin === 'tool-agentic-control')
        expect(projections.length).toBeGreaterThanOrEqual(2)

        // The terminal tool concluded the turn cleanly.
        const lastEnd = agent.session.events.findLast(event => event.type === 'turn/end')
        expect(lastEnd?.data.reason).toMatchObject({ kind: 'completed' })
        expect(turn.type).toBe('result')

        // The profile composition is intact beside the investigation seam.
        const credentials: unknown = ctx.get('credentials')
        expect((credentials as object).constructor.name).toBe('AwsSecretsManagerCredentialProvider')
        expect(ctx.llm.listProviders().map(provider => provider.id)).toContain('amazon-bedrock')
        const tools = ctx.tools.schemas().map(schema => schema.name)
        for (const tool of ORCA_TOOL_NAMES) expect(tools).toContain(tool)
        for (const tool of ['run_physical_assessment', 'finish_investigation', 'stop_unknown']) {
          expect(tools).toContain(tool)
        }
      } finally {
        await ctx.fiber.dispose()
      }
    } finally {
      restoreEnv()
      await rm(home, { recursive: true, force: true })
    }
  }, 60_000)
})
