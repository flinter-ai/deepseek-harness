import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { closeMockServers, mockServer, textEvents } from '../../../llm/llm-pi-ai/tests/mock-server.ts'

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const DSH_SOURCE_BIN = join(REPO_ROOT, 'apps/cli/src/bin.ts')
const TSCONFIG = join(REPO_ROOT, 'tsconfig.json')
const PROCESS_SECRET_MARKERS = ['ark-test-key', 'modelflare-test-key', 'deepseek-test-key']
const REQUIRED_HOST_BUNDLES = [
  'packages/interaction/commands/lib/typert.host.js',
  'packages/goal/goal/lib/typert.host.js',
  'packages/subagent/subagent/lib/typert.host.js',
  'packages/llm/llm/lib/typert.host.js',
] as const

afterEach(async () => {
  await closeMockServers()
})

function safeEnvironment(root: string, home: string): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(name)))
  return {
    ...inherited,
    DSH_HOME: home,
    DSH_AGENTS_HOME: join(root, '.agents'),
    DSH_TELEMETRY_DISABLED: '1',
    NODE_NO_WARNINGS: '1',
    NODE_OPTIONS: [
      process.env.NODE_OPTIONS,
      '--disable-warning=ExperimentalWarning',
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
    ].filter(Boolean).join(' '),
  }
}

function settingsFor(
  provider: 'modelflare' | 'deepseek-official',
  model: string,
  endpoint: string,
  reasoningEffort: string,
): string {
  return [
    'agent-default-model:',
    `  provider: ${provider}`,
    `  model: ${model}`,
    `  reasoningEffort: ${reasoningEffort}`,
    'llm-deepseek:',
    '  apiKeyEnv: DEEPSEEK_API_KEY',
    `  baseURL: ${endpoint}`,
    '  models:',
    '    - id: deepseek-v4-flash',
    '      contextWindow: 1000000',
    'llm-pi-ai:',
    '  providers:',
    '    modelflare:',
    '      api: openai-completions',
    '      apiKeyEnv: MODELFLARE_API_KEY',
    `      baseURL: ${endpoint}`,
    '      models:',
    '        - id: gpt-5.6-sol',
    '          input:',
    '            - text',
    '          contextWindow: 1000000',
    '          reasoningEfforts:',
    '            off:',
    '            low: low',
    '            high: high',
    '            max: ultra',
    '',
  ].join('\n')
}

async function prepareHome(
  root: string,
  provider: 'modelflare' | 'deepseek-official',
  model: string,
  endpoint: string,
  reasoningEffort: string,
): Promise<string> {
  const home = join(root, `${provider}-home`)
  const profile = join(home, 'profiles', 'tod')
  const sessions = join(home, 'sessions')
  await mkdir(profile, { recursive: true })
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-tod',
    private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] } },
  }, undefined, 2) + '\n')
  await writeFile(join(profile, 'cordis.patch.yml'), [
    '- id: tool-web',
    '  disabled: true',
    '- id: session-persistence-jsonl',
    '  config:',
    `    root: '${sessions}'`,
    '    compression: none',
    '',
  ].join('\n'))
  await writeFile(join(home, 'settings.yaml'), settingsFor(provider, model, endpoint, reasoningEffort), { mode: 0o600 })
  await writeFile(join(home, '.credentials.yaml'), [
    'version: 1',
    'refs:',
    '  MODELFLARE_API_KEY: modelflare-test-key',
    '  DEEPSEEK_API_KEY: deepseek-test-key',
    '',
  ].join('\n'), { mode: 0o600 })
  return home
}

function parseRecords(content: string): Record<string, unknown>[] {
  return content.split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
}

async function sessionRecords(home: string): Promise<Record<string, unknown>[]> {
  const files = (await readdir(join(home, 'sessions'), { recursive: true }))
    .filter(file => file.endsWith('.jsonl'))
  expect(files).toHaveLength(1)
  return parseRecords(await readFile(join(home, 'sessions', files[0]! ), 'utf8'))
}

async function runHeadless(root: string, home: string, task: string) {
  const launch = resolveExampleLaunch({
    srcBin: DSH_SOURCE_BIN,
    configArgs: ['--profile', 'tod', task],
    tsconfigPath: TSCONFIG,
    env: safeEnvironment(root, home),
  })
  const result = await execa(launch.command, launch.args, {
    cwd: root,
    env: launch.env,
    extendEnv: false,
    input: '',
    timeout: 90_000,
    killSignal: 'SIGKILL',
    reject: false,
  })
  if (result.exitCode !== 0) {
    throw new Error(`headless process failed (exit ${result.exitCode})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  return { result, records: await sessionRecords(home) }
}

/**
 * A source checkout does not carry generated Typert host bundles. Build them
 * once before the subprocess gate so the process test exercises the runtime,
 * not an accidental module-resolution failure in a fresh worktree.
 */
async function ensureHostBundles(): Promise<void> {
  const missing: string[] = []
  for (const relative of REQUIRED_HOST_BUNDLES) {
    try {
      await access(join(REPO_ROOT, relative))
    } catch {
      missing.push(relative)
    }
  }
  if (missing.length === 0) return
  const build = await execa('pnpm', ['run', 'build:lib:host'], {
    cwd: REPO_ROOT,
    reject: false,
    timeout: 120_000,
  })
  if (build.exitCode !== 0) {
    throw new Error(`host bundle build failed (exit ${build.exitCode})\nstdout:\n${build.stdout}\nstderr:\n${build.stderr}`)
  }
  for (const relative of REQUIRED_HOST_BUNDLES) {
    await access(join(REPO_ROOT, relative))
  }
}

function expectNativeSession(
  records: readonly Record<string, unknown>[],
  provider: string,
  model: string,
  reasoningEffort: string,
): void {
  const types = records.map(record => record.type)
  for (const type of ['session', 'turn/start', 'request/header', 'request/context', 'user/message', 'assistant/message', 'turn/end']) {
    expect(types, `missing native session event ${type}`).toContain(type)
  }
  const context = records.find(record => record.type === 'request/context')
  expect(context?.data).toMatchObject({ provider, model, contextWindow: 1_000_000 })
  const header = records.find(record => record.type === 'request/header')
  expect(header?.data).toMatchObject({
    header: { config: { provider, model, reasoningEffort } },
  })
}

describe('Phase 1 isolated alpha tod process', () => {
  it('boots both configured routes through the real CLI and persists native events without leaking credentials', async () => {
    await ensureHostBundles()
    const root = await mkdtemp(join(tmpdir(), 'flinter-dsh-alpha-process-'))
    try {
      const modelflareServer = await mockServer([
        { events: textEvents },
        { events: textEvents },
        { events: textEvents },
      ])
      const modelflareHome = await prepareHome(root, 'modelflare', 'gpt-5.6-sol', modelflareServer.url, 'low')
      const modelflareRun = await runHeadless(root, modelflareHome, 'prove the isolated alpha Modelflare process')
      expect(modelflareRun.result.exitCode, `stdout:\n${modelflareRun.result.stdout}\nstderr:\n${modelflareRun.result.stderr}`).toBe(0)
      expect(modelflareRun.result.stdout).toContain('hello')
      expect(modelflareRun.result.stderr).toBe('')
      expectNativeSession(modelflareRun.records, 'modelflare', 'gpt-5.6-sol', 'low')
      expect(modelflareServer.headers.some(header => header.authorization === 'Bearer modelflare-test-key')).toBe(true)
      expect(modelflareServer.requests.some(request => (request as { model?: string })?.model === 'gpt-5.6-sol')).toBe(true)

      const directServer = await mockServer([
        { events: textEvents },
        { events: textEvents },
        { events: textEvents },
      ])
      const directHome = await prepareHome(root, 'deepseek-official', 'deepseek-v4-flash', directServer.url, 'high')
      const directRun = await runHeadless(root, directHome, 'prove the isolated alpha direct DeepSeek process')
      expect(directRun.result.exitCode, `stdout:\n${directRun.result.stdout}\nstderr:\n${directRun.result.stderr}`).toBe(0)
      expect(directRun.result.stdout).toContain('hello')
      expect(directRun.result.stderr).toBe('')
      expectNativeSession(directRun.records, 'deepseek-official', 'deepseek-v4-flash', 'high')
      expect(
        directServer.headers.some(header => header.authorization === 'Bearer deepseek-test-key'),
        `direct paths=${JSON.stringify(directServer.paths)} auth=${JSON.stringify(directServer.headers.map(header => header.authorization))}`,
      ).toBe(true)
      expect(
        directServer.requests.some(request => (request as { model?: string })?.model === 'deepseek-v4-flash'),
        `direct models=${JSON.stringify(directServer.requests.map(request => (request as { model?: string })?.model ?? null))}`,
      ).toBe(true)

      const output = [
        modelflareRun.result.stdout,
        modelflareRun.result.stderr,
        JSON.stringify(modelflareRun.records),
        directRun.result.stdout,
        directRun.result.stderr,
        JSON.stringify(directRun.records),
      ].join('\n')
      for (const marker of PROCESS_SECRET_MARKERS) expect(output).not.toContain(marker)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)
})
