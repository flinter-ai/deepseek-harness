/**
 * spawn-dsh-worker.mjs — one-command E2 worker spawn.
 *
 * Runs the full Orca orchestration flow and launches a headless DSH worker
 * (with the @flinter/dsh-orca plugin) inside the dispatched terminal:
 *
 *   run-create -> task-create -> terminal create -> dispatch
 *   -> worker-home (per-model) -> terminal send (headless dsh + DSH_ORCA_* env)
 *
 * Model routing: --model easy -> opencode-go/deepseek-v4-flash (DeepSeek V4
 * Flash); --model hard -> kimi-coding/kimi-for-coding (Kimi K2.7 Code).
 * All workers default to the cordis (Creator mode) agent preset.
 *
 * Usage:
 *   node spawn-dsh-worker.mjs --objective "..." --spec "..." \
 *     --model hard --prompt "do X, then call worker_done" [--home /tmp/dsh-worker-x]
 *   node spawn-dsh-worker.mjs ... --dry-run        # print the plan, spawn nothing
 *
 * After spawn, wait with:
 *   orca orchestration check --run <run_id> --wait --types worker_done --timeout-ms 240000 --json
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { writeFileSync, readFileSync } from 'node:fs'

const DSH_ROOT = join(homedir(), 'deepseek-harness')
const NODE_BIN = join(homedir(), '.nvm', 'versions', 'node', 'v22.23.2', 'bin')

function flag(name, fallback) {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 ? process.argv[at + 1] : fallback
}
function orca(...argv) {
  const out = execFileSync('orca', argv, { encoding: 'utf8' })
  return JSON.parse(out)
}
function orcaOrExit(...argv) {
  try {
    return orca(...argv)
  } catch (error) {
    console.error(`spawn-dsh-worker: orca ${argv.join(' ')} failed: ${error.message}`)
    process.exit(1)
  }
}

const objective = flag('objective', 'DSH worker task')
const spec = flag('spec', objective)
const title = flag('title', 'dsh-worker')
const model = flag('model', 'easy')
const promptFile = flag('prompt-file')
const prompt = promptFile ? readFileSync(promptFile, 'utf8') : flag('prompt')
// Sandbox note: workspace-write is bounded by the session cwd, so the
// worker must launch INSIDE the repo it needs to write.
const dest = flag('dest', process.cwd())
const home = flag('home', `/tmp/dsh-worker-${model}-${Date.now()}`)
const dryRun = process.argv.includes('--dry-run')

// nadirclaw/nadir-* route through the LOCAL difficulty router (localhost:8856),
// so they work only for dispatches running on this machine — a cloud/AgentBox
// worker cannot reach them.
if (![
  'easy', 'hard', 'opencode', 'kimi', 'hard-backup', 'glm-backup', 'glm-5.3',
  'nadirclaw', 'nadir-auto', 'nadir-eco', 'nadir-premium', 'nadir-reasoning',
].includes(model)) {
  console.error(`spawn-dsh-worker: unknown --model "${model}"`)
  process.exit(1)
}

console.log(`[spawn-dsh-worker] model=${model} home=${home}`)
if (dryRun) {
  console.log('[dry-run] would: run-create / task-create / terminal create / dispatch / worker-home / terminal send')
  process.exit(0)
}

// 1. Run (bound to the invoking coordinator terminal).
const runResp = orcaOrExit('orchestration', 'run-create', '--objective', objective, '--json')
const runId = runResp.result.run.id
const coordHandle = runResp.result.run.coordinator_handle
console.log(`  run: ${runId} (coordinator ${coordHandle})`)

// 2. Task.
const taskResp = orcaOrExit('orchestration', 'task-create', '--spec', spec, '--task-title', title, '--run', runId, '--json')
const taskId = taskResp.result.task.id
console.log(`  task: ${taskId}`)

// 3. Terminal (current worktree context; the worker is a bare shell).
const termResp = orcaOrExit('terminal', 'create', '--worktree', `path:${dest}`, '--title', title, '--json')
const termHandle = termResp.result.terminal.handle
console.log(`  terminal: ${termHandle}`)

// The PTY may still be initializing right after creation; a send that lands
// too early gets mis-parsed by the shell. Wait for a settled prompt first.
try {
  execFileSync('orca', ['terminal', 'wait', '--terminal', termHandle, '--for', 'tui-idle', '--timeout-ms', '45000'], { stdio: 'inherit' })
} catch (error) {
  console.warn(`  note: terminal idle wait failed (${error.message}); continuing anyway`)
}

// 4. Dispatch for tracking (no --inject: DSH is not a recognized agent CLI).
const dispatchResp = orcaOrExit('orchestration', 'dispatch', '--task', taskId, '--to', termHandle, '--json')
const dispatchId = dispatchResp.result.dispatch.id
console.log(`  dispatch: ${dispatchId}`)

// 5. Per-model worker home.
execFileSync('bash', ['-c',
  `export PATH="${NODE_BIN}:$PATH" && cd "${DSH_ROOT}" && ` +
  `node examples/dsh-orca/worker-home.mjs --home "${home}" --model "${model}"`,
], { stdio: 'inherit' })

// 6. Launch the headless worker inside the dispatched terminal.
const promptPath = join(tmpdir(), `dsh-prompt-${taskId}.txt`)
writeFileSync(promptPath, prompt ?? spec, 'utf8')

const launch = [
  `export PATH="${NODE_BIN}:$PATH"`,
  `cd ${JSON.stringify(dest)}`,
  [
    `TSX_TSCONFIG_PATH=${JSON.stringify(join(DSH_ROOT, 'tsconfig.base.json'))}`,
    `DSH_HOME=${JSON.stringify(home)}`,
    `DSH_ORCA_RUN_ID=${JSON.stringify(runId)}`,
    `DSH_ORCA_TASK_ID=${JSON.stringify(taskId)}`,
    `DSH_ORCA_DISPATCH_ID=${JSON.stringify(dispatchId)}`,
    `DSH_ORCA_COORDINATOR=${JSON.stringify(coordHandle)}`,
    `node --import ${JSON.stringify(join(DSH_ROOT, 'node_modules/tsx/dist/esm/index.mjs'))}`,
    JSON.stringify(join(DSH_ROOT, 'apps/cli/src/bin.ts')),
    `--profile headless "$(cat ${JSON.stringify(promptPath)})"`,
  ].join(' '),
].join(' && ')
const sendResp = orcaOrExit('terminal', 'send', '--terminal', termHandle, '--text', launch, '--enter', '--json')
console.log(`  worker launched in ${termHandle}: bytes=${sendResp.result.send.bytesWritten}`)

console.log(`\nREADY: run=${runId} task=${taskId} dispatch=${dispatchId} terminal=${termHandle}`)
console.log(`wait: orca orchestration check --run ${runId} --wait --types worker_done --timeout-ms 240000 --json`)
