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
 *   easy          -> deepseek / deepseek-v4-flash   (DeepSeek V4 Flash DIRECT, api.deepseek.com via DEEPSEEK_API_KEY)
 *   opencode      -> opencode-go / deepseek-v4-flash (explicit gateway fallback, OPENCODE_GO_API_KEY)
 *   easy-backup   -> gmi-serving / deepseek-ai/DeepSeek-V4-Flash-0731
 *   backup        -> alias of easy-backup
 *   hard          -> kimi-coding / k3-256k         (Kimi K3-256K)
 *   hard-backup   -> opencode-go / glm-5.3         (backup if K3 unavailable)
 *   glm-5.3       -> opencode-go / glm-5.3
 *   kimi          -> alias of hard
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
  // easy primary: DeepSeek V4 Flash DIRECT (api.deepseek.com, DEEPSEEK_API_KEY; builtin pi-ai `deepseek` route).
  easy: { provider: 'deepseek', model: 'deepseek-v4-flash' },
  // opencode: explicit gateway fallback (opencode.ai/zen/go/v1, OPENCODE_GO_API_KEY).
  opencode: { provider: 'opencode-go', model: 'deepseek-v4-flash' },
  'easy-backup': { provider: 'gmi-serving', model: 'deepseek-ai/DeepSeek-V4-Flash-0731' },
  backup: { provider: 'gmi-serving', model: 'deepseek-ai/DeepSeek-V4-Flash-0731' },
  // hard primary: Kimi K3-256K (api.kimi.com/coding).
  hard: { provider: 'kimi-coding', model: 'k3-256k' },
  kimi: { provider: 'kimi-coding', model: 'k3-256k' },
  // hard backup when K3-256K is 404 / out of credit / unresponsive.
  'hard-backup': { provider: 'opencode-go', model: 'glm-5.3' },
  'glm-5.3': { provider: 'opencode-go', model: 'glm-5.3' },
  // NadirClaw difficulty router — LOCAL DISPATCHES ONLY.
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
  console.error(`worker-home: unknown --model "${model}" (use easy|opencode|easy-backup|backup|hard|kimi|hard-backup|glm-5.3|nadirclaw|nadir-auto|nadir-eco|nadir-premium|nadir-reasoning)`)
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

// 3. settings.yaml — declare only the models this worker may actually call.
// Real card values come from the provider's models.json / GET /v1/models, not
// invented numbers.
const OPENCODE_GO_MODELS = [
  ['deepseek-v4-flash', 'DeepSeek V4 Flash', 1000000, 384000, 'text', 'thinkingFormat: deepseek', null],
  // gpt-5.6-luna terminates correctly only on the OpenAI Responses API; DSH
  // supports per-model api, so it is listed with api: openai-responses while
  // the route keeps openai-completions for the other models.
  // Real card input is text/image/pdf; DSH's modality gate models text/image
  // today, so pdf is documented here but omitted from the generated entry.
  ['gpt-5.6-luna', 'GPT-5.6 Luna', 1050000, 128000, 'text, image', null, 'openai-responses'],
  ['glm-5.3', 'GLM-5.3', 1000000, 131072, 'text', null, null],
  ['kimi-k3', 'Kimi K3 (2x usage)', 1048576, 131072, 'text, image', null, null],
  ['kimi-k2.7-code', 'Kimi K2.7 Code', 262144, 262144, 'text, image', null, null],
].map(([id, name, ctx, maxTok, input, compat, api]) =>
  (id === 'gpt-5.6-luna'
    ? `        # gpt-5.6-luna speaks the OpenAI Responses API, not chat/completions.\n        - id: ${id}\n          name: ${name}\n          api: ${api}\n          contextWindow: ${ctx}\n          maxTokens: ${maxTok}\n          input: [${input}]`
    : `        - id: ${id}\n          name: ${name}\n          contextWindow: ${ctx}\n          maxTokens: ${maxTok}\n          input: [${input}]`)
  + (compat ? `\n          compat:\n            ${compat}` : ''))
const GMI_SERVING_MODELS = [
  ['deepseek-ai/DeepSeek-V4-Flash-0731', 'GMI DeepSeek V4 Flash 0731', 1000000, 384000, 'text', null],
].map(([id, name, ctx, maxTok, input, compat]) =>
  `        - id: ${id}\n          name: ${name}\n          contextWindow: ${ctx}\n          maxTokens: ${maxTok}\n          input: [${input}]`
  + (compat ? `\n          compat:\n            ${compat}` : ''))
const NADIRCLAW_MODELS = [
  ['nadir-auto', 'NadirClaw Auto', 1000000, 384000, 'text', null],
  ['nadir-eco', 'NadirClaw Eco', 1000000, 384000, 'text', null],
  ['nadir-premium', 'NadirClaw Premium', 1000000, 384000, 'text', null],
  ['nadir-reasoning', 'NadirClaw Reasoning', 1000000, 384000, 'text', null],
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
  '    gmi-serving:',
  '      apiKeyEnv: GMI_SERVING_API_KEY',
  '      api: openai-completions',
  '      baseURL: https://api.gmi-serving.com/v1',
  '      models:',
  ...GMI_SERVING_MODELS,
  '    kimi-coding:',
  '      apiKeyEnv: KIMI_CODING_API_KEY',
  '    nadirclaw:',
  '      apiKeyEnv: NADIRCLAW_API_KEY',
  '      api: openai-completions',
  '      baseURL: http://localhost:8856/v1',
  '      models:',
  ...NADIRCLAW_MODELS,
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
