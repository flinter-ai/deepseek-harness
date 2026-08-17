/**
 * worker-home.mjs — create a per-model DSH worker home.
 *
 * A worker home is an isolated DSH_HOME with:
 *   - the `headless` profile containing the @flinter/dsh-orca plugin
 *   - the DSH credential file copied from ~/.dsh/.credentials.yaml
 *   - settings.yaml with the requested agent-default-model + cordis (Creator
 *     mode) preset default
 *
 * Model routing (phase 1):
 *   easy        -> deepseek-official / deepseek-v4-flash (direct DeepSeek API)
 *   opencode    -> opencode-go / deepseek-v4-flash (gateway route)
 *   hard        -> kimi-coding / k3-256k           (Kimi K3-256K)
 *   hard-backup -> opencode-go / glm-5.2           (GLM backup if K3 is 404/out of credit)
 *   opencode alias of easy; kimi alias of hard; glm-backup alias of hard-backup.
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
  // easy now routes DIRECT to DeepSeek (@deepseek-ai/dsh-llm-deepseek,
  // api.deepseek.com, DEEPSEEK_API_KEY) rather than through opencode.go,
  // whose weekly quota exhausted mid-task on 2026-08-16.
  easy: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  // opencode keeps the old gateway route, for when it is wanted explicitly.
  opencode: { provider: 'opencode-go', model: 'deepseek-v4-flash' },
  // hard primary: Kimi K3-256K (api.kimi.com/coding).
  hard: { provider: 'kimi-coding', model: 'k3-256k' },
  kimi: { provider: 'kimi-coding', model: 'k3-256k' },
  // hard backup (respawn when K3-256K is 404 / out of credit / unresponsive):
  // GLM-5.3 is offered on opencode.go but absent from the pi-ai catalog; the
  // explicit models list in settings makes it callable. glm-5.2 remains the
  // battle-tested fallback tier.
  'hard-backup': { provider: 'opencode-go', model: 'glm-5.2' },
  'glm-backup': { provider: 'opencode-go', model: 'glm-5.2' },
  'glm-5.3': { provider: 'opencode-go', model: 'glm-5.3' },
  // NadirClaw difficulty router — LOCAL DISPATCHES ONLY. It listens on
  // http://localhost:8856/v1 (com.flinter.nadirclaw LaunchAgent), so a worker
  // running in an Orca terminal on this machine can reach it and a
  // cloud/AgentBox worker cannot. Do NOT set this as a default for cloud work.
  // `auto` classifies each prompt and routes to the cheapest tier that can
  // answer, escalating on failure; the fixed tiers are there when you want to
  // pin one. See skills/dsh-orca-worker SKILL.md for the two caveats that still
  // stand (the server ignores auth, and routing decisions are not yet logged,
  // so a misroute degrades quality silently).
  nadirclaw: { provider: 'nadirclaw', model: 'auto' },
  'nadir-auto': { provider: 'nadirclaw', model: 'nadir-auto' },
  'nadir-eco': { provider: 'nadirclaw', model: 'nadir-eco' },
  'nadir-premium': { provider: 'nadirclaw', model: 'nadir-premium' },
  'nadir-reasoning': { provider: 'nadirclaw', model: 'nadir-reasoning' },
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
  console.error(`worker-home: unknown --model "${model}" (use easy|hard|opencode|kimi)`)
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
execFileSync('bash', ['-c',
  `export PATH="${nodeBin}:$PATH" && cd "${dshRoot}" && ` +
  `DSH_HOME="${home}" npx pnpm@11.7.0 dsh plugin --profile headless add "${pluginDir}"`,
], { stdio: 'inherit' })

// 2. Credentials (same machine; file stays 0600 from the copy).
copyFileSync(sourceCreds, join(home, '.credentials.yaml'))

// 3. settings.yaml — both routes declared (both keys exist), default = selection.
// The opencode-go route carries an explicit models list so GLM-5.3 (offered on
// opencode.go, absent from the pi-ai snapshot catalog) is callable.
const OPENCODE_GO_MODELS = [
  ['deepseek-v4-flash', 'DeepSeek V4 Flash', 1000000, 384000, 'text', 'thinkingFormat: deepseek'],
  ['deepseek-v4-pro', 'DeepSeek V4 Pro', 1000000, 384000, 'text', 'thinkingFormat: deepseek'],
  ['glm-5.2', 'GLM-5.2', 1000000, 131072, 'text', null],
  ['glm-5.3', 'GLM-5.3', 1000000, 131072, 'text', null],
  ['kimi-k3', 'Kimi K3 (2x usage)', 1048576, 131072, 'text, image', null],
  ['kimi-k2.7-code', 'Kimi K2.7 Code', 262144, 262144, 'text, image', null],
].map(([id, name, ctx, maxTok, input, compat]) =>
  `        - id: ${id}\n          name: ${name}\n          contextWindow: ${ctx}\n          maxTokens: ${maxTok}\n          input: [${input}]`
  + (compat ? `\n          compat:\n            ${compat}` : ''))
const settings = [
  'ui-onboarding:',
  '  welcomeNoticeVersion: 2026-08-13.1',
  'agent-presets:',
  '  default: cordis',
  'llm-pi-ai:',
  '  providers:',
  '    opencode-go:',
  '      apiKeyEnv: OPENCODE_GO_API_KEY',
  '      api: openai-completions',
  '      baseURL: https://opencode.ai/zen/go/v1',
  '      models:',
  ...OPENCODE_GO_MODELS,
  '    kimi-coding:',
  '      apiKeyEnv: KIMI_CODING_API_KEY',
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
