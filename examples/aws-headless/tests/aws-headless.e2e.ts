import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { boot, healProfilesModuleFallback, loadProfile } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import { CLI_BIN, INSTALL_ANCHOR, REPO_ROOT, TSCONFIG, materializeProfile, sanitizeAwsEnv } from './profile.ts'

const ORCA_TOOL_NAMES = ['worker_done', 'orca_check_inbox', 'orca_ask', 'orca_heartbeat', 'agentbox_launch']

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}

/** Run the real CLI's profile composition dump from source, keyless. */
function runDumpConfig(home: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx/esm', CLI_BIN, '--profile', 'aws-headless', '--dump-config'],
      { cwd: REPO_ROOT, env: { ...process.env, DSH_HOME: home, TSX_TSCONFIG_PATH: TSCONFIG } },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr })
    })
  })
}

describe('aws-headless profile structural smoke', () => {
  it('composes the bedrock, secrets-manager, and orca rows exactly once (composition gate)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-aws-headless-'))
    try {
      await materializeProfile(home)
      const { code, stdout, stderr } = await runDumpConfig(home)
      expect(stderr).toBe('')
      expect(code).toBe(0)
      expect(occurrences(stdout, "name: '@flinter/dsh-orca'")).toBe(1)
      expect(occurrences(stdout, "name: '@deepseek-ai/dsh-credentials-aws-secrets-manager'")).toBe(1)
      expect(occurrences(stdout, 'amazon-bedrock')).toBe(1)
      // The S1 segment and searchable-trace plugin mount beside the existing
      // AWS rows; the dsh-pes row is pinned to the immutable engine producer
      // SHA, so the pin shows up exactly once in the composed config.
      expect(occurrences(stdout, "name: '@flinter/dsh-segment'")).toBe(1)
      expect(occurrences(stdout, "name: '@flinter/dsh-pes'")).toBe(1)
      expect(occurrences(stdout, 'c05c3fc747f0aa0fcb9d0603009add71c59e091b')).toBe(1)
      // The replaced local credential store stays in the tree, disabled.
      expect(stdout).toMatch(/- id: credentials\n {2}name: '@deepseek-ai\/dsh-credentials-local'\n {2}disabled: true/)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  }, 60_000)

  it('activates all three capabilities with zero AWS calls and disposes cleanly (boot gate)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-aws-headless-'))
    const restoreEnv = sanitizeAwsEnv(home)
    try {
      const profileDir = await materializeProfile(home)
      healProfilesModuleFallback(INSTALL_ANCHOR, home)
      const profile = loadProfile('dsh-test', 'aws-headless', INSTALL_ANCHOR, home)
      const patches: PatchOptions[] = [
        ...profile.layers.flatMap(layer => layer.patches),
        ...profile.patches,
        // Pin the settings document into the temp home so the developer's own
        // $DSH_HOME/settings.yaml cannot decide this boot.
        { id: 'settings', config: { path: join(home, 'settings.yaml'), watch: false } },
        { id: 'session-telemetry-otel', disabled: true },
      ]
      const ctx = await boot('dsh-test', join(profileDir, 'cordis.yml'), patches, (bootCtx) => {
        provideCmdline(bootCtx, { args: [], exit: () => {} })
      })
      try {
        // Not instanceof: the test imports src through the tsconfig paths
        // facade while the Loader resolves the package exports → lib.
        const credentials: unknown = ctx.get('credentials')
        expect((credentials as object).constructor.name).toBe('AwsSecretsManagerCredentialProvider')
        expect(ctx.llm.listProviders().map(provider => provider.id)).toContain('amazon-bedrock')
        const tools = ctx.tools.schemas().map(schema => schema.name)
        for (const tool of ORCA_TOOL_NAMES) expect(tools).toContain(tool)
        // The integrated S1 segment + searchable-trace surface registers
        // beside the AWS rows; tool registration is boot-time proof.
        for (const tool of ['RUN_BASELINE_PHYSICS', 'search_events', 'find_similar_states', 'find_counterfactuals', 'zoom']) {
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
