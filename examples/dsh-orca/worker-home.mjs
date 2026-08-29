/**
 * worker-home.mjs — create a per-model DSH worker home.
 *
 * A worker home is an isolated DSH_HOME with:
 *   - the `headless` profile containing the @flinter/dsh-orca plugin
 *   - the DSH credential file copied from ~/.dsh/.credentials.yaml
 *   - settings.yaml with the requested agent-default-model + cordis (Creator
 *     mode) preset default
 *
 * Model routing:
 *   easy          -> ark-agent-plan / ark-code-latest
 *   backup        -> modelflare / gpt-5.6-sol
 *   deepseek      -> deepseek-official / deepseek-v4-flash (direct DeepSeek)
 *   nadirclaw     -> NadirClaw difficulty router (localhost only)
 *
 * Usage:
 *   node worker-home.mjs --home /tmp/dsh-worker-easy --model easy
 *   node worker-home.mjs --home /tmp/dsh-worker-hard --model hard
 *
 * Optional flags: --dsh-root <harness checkout> (default ~/deepseek-harness),
 * --plugin <dir>, --node <nvm node bin dir>, --creds <file>, --settings <file>.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const MODELS = {
  easy: { provider: 'ark-agent-plan', model: 'ark-code-latest' },
  backup: { provider: 'modelflare', model: 'gpt-5.6-sol' },
  deepseek: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
}

function flag(name, fallback) {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 ? process.argv[at + 1] : fallback
}

const home = flag('home')
const model = flag('model', 'easy')
const dshRoot = flag('dsh-root', join(homedir(), 'deepseek-harness'))
const pluginDir = flag('plugin', join(dshRoot, 'examples', 'dsh-orca'))
const nodeBin = flag('node', join(homedir(), '.nvm', 'versions', 'node', 'v22.23.2', 'bin'))
const sourceCreds = flag('creds', join(homedir(), '.dsh', '.credentials.yaml'))
const sourceSettings = flag('settings', join(homedir(), '.dsh', 'settings.yaml'))

const selection = MODELS[model]
if (selection === undefined) {
  console.error(`worker-home: unknown --model "${model}" (use easy|backup|deepseek)`)
  process.exit(1)
}
if (!home) {
  console.error('worker-home: --home <path> is required')
  process.exit(1)
}
if (!existsSync(sourceCreds)) {
  console.error(`worker-home: credentials not found at ${sourceCreds}`)
  process.exit(1)
}

mkdirSync(home, { recursive: true })

// 1. Initialize the headless profile and install the plugin bundle.
//    execFileSync with argv + env override so nodeBin/dshRoot/home/pluginDir
//    cannot be evaluated by a shell. A bash -c form would re-introduce
//    injection: any value containing `$` or backticks would be expanded
//    before npx ever ran.
execFileSync('npx', ['pnpm@11.7.0', 'dsh', 'plugin', '--profile', 'headless', 'add', pluginDir], {
  cwd: dshRoot,
  env: { ...process.env, PATH: `${nodeBin}:${process.env.PATH ?? ''}`, DSH_HOME: home },
  stdio: 'inherit',
})

// 2. Credentials (same machine; file stays 0600 from the copy).
copyFileSync(sourceCreds, join(home, '.credentials.yaml'))

// 3. settings.yaml — declare only the models this worker may actually call.
// Real card values come from the provider's models.json / GET /v1/models, not
// invented numbers.
const ARK_PLAN_MODELS = [
  '        - id: ark-code-latest',
  '          name: ARK Code Latest',
  '          contextWindow: 1048576',
  '          maxTokens: 131072',
  '          input: [text]',
]
const MODELFLARE_MODELS = [
  '        - id: gpt-5.6-sol',
  '          name: GPT-5.6 Sol',
  '          input: [text]',
]
const settings = [
  'ui-onboarding:',
  '  welcomeNoticeVersion: 2026-08-13.1',
  'agent-presets:',
  '  default: cordis',
  'llm-pi-ai:',
  '  providers:',
  '    ark-agent-plan:',
  '      apiKeyEnv: ARK_PLAN_API_KEY',
  '      api: openai-completions',
  '      baseURL: https://ark.cn-beijing.volces.com/api/plan/v3',
  '      models:',
  ...ARK_PLAN_MODELS,
  '    modelflare:',
  '      apiKeyEnv: MODELFLARE_API_KEY',
  '      api: openai-completions',
  '      baseURL: https://modelflare.dev/v1',
  '      models:',
  ...MODELFLARE_MODELS,
  'agent-default-model:',
  `  provider: ${selection.provider}`,
  `  model: ${selection.model}`,
  '',
].join('\n')
writeFileSync(join(home, 'settings.yaml'), settings, { mode: 0o600 })

console.log(`worker-home: ${home}`)
console.log(`  profile: headless (plugin ${pluginDir})`)
console.log(`  agent-default-model: ${selection.provider} / ${selection.model}`)
console.log(`  agent-presets default: cordis (Creator mode)`)
