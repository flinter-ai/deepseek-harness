/**
 * spawn-dsh-worker.mjs — one-command DSH worker spawn through Orca.
 *
 * This is a thin coordinator helper. The actual worker is launched BY ORCA
 * using `terminal create --command dsh-agent`. The flow is:
 *
 *   run-create -> task-create -> terminal create --command dsh-agent -> dispatch
 *   -> terminal send (JSON payload) -> dsh-agent parses payload and launches DSH
 *
 * DSH (with the @flinter/dsh-orca plugin) then executes the task and calls
 * worker_done back to the Run.
 *
 * Usage:
 *   node spawn-dsh-worker.mjs --objective "..." --spec "..." \
 *     --model hard --prompt "do X, then call worker_done" [--dest <repo>]
 *   node spawn-dsh-worker.mjs ... --dry-run
 *
 * After spawn, wait with:
 *   orca orchestration check --run <run_id> --wait --types worker_done --timeout-ms 240000 --json
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readFileSync } from 'node:fs'
import { assertCanaryProof } from './reliability.mjs'

function git(dest, ...args) {
  return execFileSync('git', ['-C', dest, ...args], { encoding: 'utf8' }).trim()
}

const DSH_ROOT = process.env.DSH_HARNESS_ROOT ?? join(homedir(), 'deepseek-harness')
const DSH_AGENT = join(DSH_ROOT, 'examples', 'dsh-orca', 'dsh-agent.mjs')

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
const tmpRoot = flag('tmp-root', process.env.DSH_ORCA_TMP_ROOT ?? '/tmp/dsh')
const artifactRoot = flag('artifact-root', process.env.DSH_ORCA_ARTIFACT_ROOT ?? '/tmp/dsh-artifacts')
const from = flag('from', process.env.DSH_ORCA_COORDINATOR)
const canaryProof = flag('require-canary')
const retryRequest = flag('retry-request')
const dryRun = process.argv.includes('--dry-run')

if (![
  'easy', 'easy-backup', 'backup',
  'hard', 'kimi', 'hard-backup', 'glm-5.3',
  'nadirclaw', 'nadir-auto', 'nadir-eco', 'nadir-premium', 'nadir-reasoning',
].includes(model)) {
  console.error(`spawn-dsh-worker: unknown --model "${model}"`)
  process.exit(1)
}

if (!from && !dryRun) {
  console.error('spawn-dsh-worker: --from <coordinator-handle> is required for a live dispatch')
  process.exit(1)
}
if (canaryProof) assertCanaryProof(canaryProof)

// Preflight: mirror the destination-safety contract from the general
// orchestration skill. Resolve the exact repo, record HEAD/branch/upstream,
// fetch origin, and refuse to launch into a dirty or diverged tree.
let preflight = {}
try {
  const gitRoot = git(dest, 'rev-parse', '--show-toplevel')
  const branch = git(gitRoot, 'branch', '--show-current')
  const head = git(gitRoot, 'rev-parse', 'HEAD')
  const status = git(gitRoot, 'status', '--porcelain=v1', '-b')
  let upstream = null
  try {
    upstream = git(gitRoot, 'rev-parse', '--abbrev-ref', '@{upstream}')
  } catch {
    upstream = null
  }
  const isDirty = status.split('\n').some((line) => line && !line.startsWith('##'))

  console.log(`[preflight] root=${gitRoot}`)
  console.log(`[preflight] branch=${branch} head=${head} upstream=${upstream ?? 'none'}`)
  console.log(`[preflight] dirty=${isDirty}`)

  preflight = { gitRoot, branch, head, upstream, isDirty, status }

  // Fetch origin so the comparison is current. This is read-only metadata.
  try {
    git(gitRoot, 'fetch', 'origin')
    const mergeBase = git(gitRoot, 'merge-base', 'HEAD', 'origin/main')
    const localMerge = git(gitRoot, 'rev-parse', 'HEAD')
    const remoteMerge = git(gitRoot, 'rev-parse', 'origin/main')
    console.log(`[preflight] origin/main=${remoteMerge} merge-base=${mergeBase}`)
    if (mergeBase !== localMerge && mergeBase !== remoteMerge) {
      console.error('[preflight] ERROR: branch is diverged from origin/main (merge-base differs from both sides)')
      process.exit(1)
    }
  } catch (fetchError) {
    console.warn(`[preflight] could not compare with origin/main: ${fetchError.message}`)
  }

  if (isDirty && !process.argv.includes('--allow-dirty')) {
    console.error('[preflight] ERROR: destination has uncommitted changes. Commit/stash first, or pass --allow-dirty.')
    process.exit(1)
  }
} catch (error) {
  console.error(`[preflight] ERROR: ${error.message}`)
  process.exit(1)
}

console.log(`[spawn-dsh-worker] model=${model} dest=${dest} tmpRoot=${tmpRoot} artifactRoot=${artifactRoot}`)
if (dryRun) {
  console.log('[preflight] passed (dry-run)')
  console.log('[dry-run] would: run-create / task-create / terminal create --command dsh-agent / dispatch / terminal send payload')
  process.exit(0)
}

// 1. Run (bound to the invoking coordinator terminal).
const runArgs = ['orchestration', 'run-create', '--objective', objective, '--from', from, '--json']
if (retryRequest) runArgs.push('--retry-request', retryRequest)
const runResp = orcaOrExit(...runArgs)
const runId = runResp.result.run.id
const coordHandle = runResp.result.run.coordinator_handle
console.log(`  run: ${runId} (coordinator ${coordHandle})`)

// 2. Task.
const taskResp = orcaOrExit('orchestration', 'task-create', '--spec', spec, '--task-title', title, '--run', runId, '--from', coordHandle, '--json')
const taskId = taskResp.result.task.id
console.log(`  task: ${taskId}`)

// 3. Terminal: Orca launches dsh-agent as the terminal command.
//    DSH is the worker; Orca owns the terminal lifecycle.
const command = `node ${JSON.stringify(DSH_AGENT)} --model ${JSON.stringify(model)} --tmp-root ${JSON.stringify(tmpRoot)} --artifact-root ${JSON.stringify(artifactRoot)} --dsh-root ${JSON.stringify(DSH_ROOT)}`
const termResp = orcaOrExit('terminal', 'create', '--worktree', `path:${dest}`, '--title', title, '--command', command, '--json')
const termHandle = termResp.result.terminal.handle
console.log(`  terminal: ${termHandle}`)

// Wait for dsh-agent to start and print its "waiting" line.
try {
  execFileSync('orca', ['terminal', 'wait', '--terminal', termHandle, '--for', 'tui-idle', '--timeout-ms', '45000'], { stdio: 'inherit' })
} catch (error) {
  console.warn(`  note: terminal idle wait failed (${error.message}); continuing anyway`)
}

// 4. Dispatch for tracking (no --inject: DSH is not a recognized Orca agent CLI).
const dispatchResp = orcaOrExit('orchestration', 'dispatch', '--task', taskId, '--to', termHandle, '--from', coordHandle, '--run', runId, '--json')
const dispatchId = dispatchResp.result.dispatch.id
console.log(`  dispatch: ${dispatchId}`)

// 5. Send the compact JSON payload that dsh-agent expects.
const payload = JSON.stringify({
  orchestration: {
    runId,
    taskId,
    dispatchId,
    coordinator: coordHandle,
  },
  task: prompt ?? spec,
})
const sendResp = orcaOrExit('terminal', 'send', '--terminal', termHandle, '--text', payload, '--enter', '--json')
console.log(`  payload sent: bytes=${sendResp.result.send.bytesWritten}`)

console.log(`\nREADY: run=${runId} task=${taskId} dispatch=${dispatchId} terminal=${termHandle}`)
console.log(`wait: orca orchestration check --run ${runId} --terminal ${coordHandle} --wait --types worker_done --timeout-ms 240000 --json`)
