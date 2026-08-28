#!/usr/bin/env node
/**
 * dsh-agent — Orca-native DSH worker launcher.
 *
 * Run this as the main command of an Orca terminal:
 *
 *   orca terminal create --worktree id:<repo>::<path> \
 *     --command "node /Users/oldap/deepseek-harness/examples/dsh-orca/dsh-agent.mjs --model easy"
 *
 * Then send the task payload into the terminal. The payload can be either
 * Orca's own injected preamble (if --inject is ever enabled for dsh) or a
 * compact JSON envelope:
 *
 *   {
 *     "orchestration": {
 *       "runId": "run_...",
 *       "taskId": "task_...",
 *       "dispatchId": "ctx_...",
 *       "coordinator": "term_..."
 *     },
 *     "task": "refactor the error handling module"
 *   }
 *
 * dsh-agent reads the payload from stdin, extracts the task context, builds an
 * isolated DSH_HOME, and execs the headless DeepSeek Harness with the task as
 * its prompt. The @flinter/dsh-orca plugin inside the harness provides
 * worker_done, heartbeat, ask, and escalation tools that route back to Orca.
 *
 * If the primary model fails with a quota/provider error, dsh-agent retries
 * once with the configured fallback model. If both fail, it sends a
 * worker_done(failed) to the coordinator so the dispatch does not hang.
 */
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { parseOrcaPreamble } from './preamble.js'
import { isProviderError } from './failure-classifier.mjs'
import { buildDshLaunchCommand } from './launch-command.mjs'

const DSH_ROOT = join(homedir(), 'deepseek-harness')
const NODE_BIN = join(homedir(), '.nvm', 'versions', 'node', 'v22.23.2', 'bin')
const GMI_ENV = join(homedir(), '.flinter', 'gmi-env.sh')

const FALLBACK = {
  easy: 'easy-backup',
  hard: 'hard-backup',
}

function flag(name, fallback) {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 ? process.argv[at + 1] : fallback
}

async function readStdin(timeoutMs = 60000, idleMs = 300) {
  return new Promise((resolve) => {
    const chunks = []
    let timer
    const finish = () => {
      clearTimeout(timer)
      resolve(chunks.join(''))
    }
    timer = setTimeout(finish, timeoutMs)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      chunks.push(chunk)
      clearTimeout(timer)
      timer = setTimeout(finish, idleMs)
    })
    process.stdin.on('end', finish)
    process.stdin.on('error', finish)
  })
}

function tryParseJson(text) {
  try {
    const parsed = JSON.parse(text)
    if (parsed?.orchestration?.taskId && parsed?.task !== undefined) {
      return {
        runId: parsed.orchestration.runId,
        taskId: parsed.orchestration.taskId,
        dispatchId: parsed.orchestration.dispatchId,
        coordinator: parsed.orchestration.coordinator,
        taskSpec: parsed.task,
      }
    }
  } catch {
    // fall through to preamble parser
  }
  return null
}

function parsePayload(text) {
  return tryParseJson(text) ?? parseOrcaPreamble(text) ?? null
}

function prepareHome(home, profile, model, dshRoot, nodeBin) {
  execFileSync('bash', ['-c',
    `export PATH="${nodeBin}:$PATH" && cd "${dshRoot}" && ` +
    `DSH_HOME="${home}" npx pnpm@11.7.0 dsh plugin --profile "${profile}" add "${join(dshRoot, 'examples', 'dsh-orca')}"`,
  ], { stdio: 'inherit' })
  execFileSync('node', [
    join(dshRoot, 'examples', 'dsh-orca', 'worker-home.mjs'),
    '--home', home,
    '--model', model,
    '--dsh-root', dshRoot,
    '--node', nodeBin,
  ], { stdio: 'inherit' })
}

function sendFailure(ctx, summary) {
  const runId = ctx.runId ?? ctx.DSH_ORCA_RUN_ID
  const taskId = ctx.taskId ?? ctx.DSH_ORCA_TASK_ID
  const dispatchId = ctx.dispatchId ?? ctx.DSH_ORCA_DISPATCH_ID
  if (!runId || !taskId || !dispatchId) {
    console.error('[dsh-agent] no orchestration context; cannot report failure to Orca')
    return
  }
  try {
    const safeSummary = typeof summary === 'string' ? summary.slice(0, 500) : String(summary).slice(0, 500)
    const argv = [
      'orchestration', 'send',
      '--run', runId,
      '--task-id', taskId,
      '--dispatch-id', dispatchId,
      '--subject', `worker_done: ${taskId}`,
      '--type', 'worker_done',
      '--outcome', 'failed',
      '--body', JSON.stringify({ summary: safeSummary }),
    ]
    execFileSync('orca', argv, { encoding: 'utf8', timeout: 60000 })
    console.log('[dsh-agent] reported failure to Orca')
  } catch (error) {
    console.error(`[dsh-agent] could not report failure to Orca: ${error.message}`)
  }
}

function launchDsh(home, profile, model, taskSpec, orcaEnv, dshRoot, nodeBin) {
  const launch = buildDshLaunchCommand({
    home,
    profile,
    taskSpec,
    orcaEnv,
    dshRoot,
    nodeBin,
    cwd: process.cwd(),
    gmiEnv: existsSync(GMI_ENV) ? GMI_ENV : null,
  })
  try {
    // Capture both stdout and stderr so we can inspect them for provider errors.
    // Print them after the fact so the terminal still sees the session log.
    const result = execFileSync(launch.file, launch.args, {
      encoding: 'utf8',
      env: launch.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    })
    if (result) process.stdout.write(result)
    return { ok: true }
  } catch (error) {
    const stdout = error.stdout?.toString() ?? ''
    const stderr = error.stderr?.toString() ?? ''
    if (stdout) process.stdout.write(stdout)
    if (stderr) process.stderr.write(stderr)
    return { ok: false, output: `${stdout}\n${stderr}`.trim() }
  }
}

async function main() {
  const profile = flag('profile', 'headless')
  const model = flag('model', 'easy')
  const dshRoot = flag('dsh-root', DSH_ROOT)
  const nodeBin = flag('node', NODE_BIN)
  const home = flag('home', `/tmp/dsh-worker-${model}`)
  const dryRun = process.argv.includes('--dry-run')

  console.log(`[dsh-agent] profile=${profile} model=${model} home=${home}`)
  console.log('[dsh-agent] waiting for task payload on stdin...')
  const raw = await readStdin()
  const payload = parsePayload(raw)

  let taskSpec
  let orcaEnv = {}

  if (payload) {
    console.log(`[dsh-agent] payload parsed: task=${payload.taskId}`)
    orcaEnv = {
      DSH_ORCA_RUN_ID: payload.runId,
      DSH_ORCA_TASK_ID: payload.taskId,
      DSH_ORCA_DISPATCH_ID: payload.dispatchId,
      DSH_ORCA_COORDINATOR: payload.coordinator,
    }
    taskSpec = payload.taskSpec
  } else {
    console.log('[dsh-agent] no orchestration payload detected; using stdin as plain prompt')
    taskSpec = raw.trim()
  }

  if (dryRun) {
    console.log('[dsh-agent] dry-run; would launch:')
    const launch = buildDshLaunchCommand({
      home,
      profile,
      taskSpec,
      orcaEnv,
      dshRoot,
      nodeBin,
      cwd: process.cwd(),
      gmiEnv: existsSync(GMI_ENV) ? GMI_ENV : null,
    })
    console.log(`${launch.file} ${launch.args[0]} ${launch.args[1]}`)
    return
  }

  console.log('[dsh-agent] preparing worker home...')
  prepareHome(home, profile, model, dshRoot, nodeBin)

  console.log(`[dsh-agent] launching DSH with model=${model}...`)
  const first = launchDsh(home, profile, model, taskSpec, orcaEnv, dshRoot, nodeBin)
  if (first.ok) return

  const fallback = FALLBACK[model]
  if (fallback && isProviderError(first.output)) {
    console.warn(`[dsh-agent] primary model failed with provider error; trying fallback ${fallback}...`)
    const fallbackHome = `${home}-${fallback}`
    prepareHome(fallbackHome, profile, fallback, dshRoot, nodeBin)
    const second = launchDsh(fallbackHome, profile, fallback, taskSpec, orcaEnv, dshRoot, nodeBin)
    if (second.ok) return

    sendFailure(orcaEnv, `DSH failed on primary (${model}) and fallback (${fallback})`)
  } else {
    sendFailure(orcaEnv, `DSH failed on ${model}`)
  }
}

main().catch((error) => {
  console.error(`[dsh-agent] fatal: ${error.message}`)
  console.error(error.stack)
  process.exit(1)
})
