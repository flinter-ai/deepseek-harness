import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { boot, healProfilesModuleFallback, loadProfile } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
/** The checked-in profile template the smoke materializes into a temp DSH_HOME. */
const PROFILE_TEMPLATE = fileURLToPath(new URL('../profile/', import.meta.url))
const INSTALL_ANCHOR = join(REPO_ROOT, 'apps/cli/package.json')
const CLI_BIN = join(REPO_ROOT, 'apps/cli/src/bin.ts')
const TSCONFIG = join(REPO_ROOT, 'tsconfig.json')

const ORCA_TOOL_NAMES = ['worker_done', 'orca_check_inbox', 'orca_ask', 'orca_heartbeat', 'agentbox_launch']

/**
 * Copy the template into `<home>/profiles/aws-headless` and link the two
 * packages that sit outside the app/bundle dependency closure — the same
 * mechanism `dsh plugin --profile aws-headless add <path>` uses.
 */
async function materializeProfile(home: string): Promise<string> {
  const profileDir = join(home, 'profiles', 'aws-headless')
  await mkdir(join(profileDir, 'node_modules', '@flinter'), { recursive: true })
  await mkdir(join(profileDir, 'node_modules', '@deepseek-ai'), { recursive: true })
  await copyFile(join(PROFILE_TEMPLATE, 'package.json'), join(profileDir, 'package.json'))
  await copyFile(join(PROFILE_TEMPLATE, 'cordis.patch.yml'), join(profileDir, 'cordis.patch.yml'))
  await symlink(join(REPO_ROOT, 'examples/dsh-orca'), join(profileDir, 'node_modules', '@flinter', 'dsh-orca'), 'dir')
  await symlink(
    join(REPO_ROOT, 'packages/credentials/dsh-credentials-aws-secrets-manager'),
    join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-credentials-aws-secrets-manager'),
    'dir',
  )
  await writeFile(join(profileDir, 'cordis.yml'), '[]\n')
  return profileDir
}

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
      // The replaced local credential store stays in the tree, disabled.
      expect(stdout).toMatch(/- id: credentials\n {2}name: '@deepseek-ai\/dsh-credentials-local'\n {2}disabled: true/)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  }, 60_000)

  it('activates all three capabilities with zero AWS calls and disposes cleanly (boot gate)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-aws-headless-'))
    const savedEnv = { ...process.env }
    try {
      const profileDir = await materializeProfile(home)
      // Prove activation needs nothing from AWS: strip every credential/region
      // source and disable IMDS, so any Secrets Manager call during boot would
      // fail loud instead of borrowing the developer's credential chain.
      for (const key of Object.keys(process.env)) {
        if (key.startsWith('AWS_')) Reflect.deleteProperty(process.env, key)
      }
      process.env.AWS_EC2_METADATA_DISABLED = 'true'
      process.env.DSH_HOME = home
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
      } finally {
        await ctx.fiber.dispose()
      }
    } finally {
      for (const key of Object.keys(process.env)) Reflect.deleteProperty(process.env, key)
      Object.assign(process.env, savedEnv)
      await rm(home, { recursive: true, force: true })
    }
  }, 60_000)
})
