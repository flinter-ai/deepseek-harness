/**
 * agentbox_launch tool — provision/poll/smoke/delete a GMI AgentBox bounded
 * task via flinter-data-infra/scripts/gmi-task.mjs.
 *
 * Architecture decision A: agents OPERATE the workflow; the durable SDK owns
 * it. This tool executes a bounded AgentBox lifecycle; the canonical workflow
 * state and records stay in the task SDK / TowerN stack. Never proxy media or
 * credentials — the token stays in the child process (Keychain -> env), never
 * here, never logged.
 */
import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { quoteShell } from './quote-shell.mjs'

export const DEFAULT_GMI_SCRIPT = '/Users/oldap/flinter/flinter-data-infra/scripts/gmi-task.mjs'
export const GMI_ENV_FILE = join(homedir(), '.flinter', 'gmi-env.sh')

const ACTIONS = ['provision', 'poll', 'list', 'smoke', 'delete']
const ACTION_TIMEOUTS = { provision: 360000, poll: 420000, smoke: 120000, delete: 60000, list: 60000 }

/** Non-throwing GMI environment gate. */
export async function gmiEnvStatus() {
  const token = typeof process.env.GMI_MANAGEMENT_TOKEN === 'string' && process.env.GMI_MANAGEMENT_TOKEN.length > 0
  let envFile = false
  try {
    await access(GMI_ENV_FILE, constants.R_OK)
    envFile = true
  } catch {
    envFile = false
  }
  return { token, envFile, ready: token || envFile }
}

function buildCommand(script, action, args) {
  const nodeArgs = ['--', script, action]
  if (args.deployment) nodeArgs.push('--deployment', args.deployment)
  if (args.template) nodeArgs.push('--template', args.template)
  if (args.task_id) nodeArgs.push('--task', args.task_id)
  if (args.endpoint) nodeArgs.push('--endpoint', args.endpoint)
  return nodeArgs
}

/**
 * Run one gmi-task action. Prefers a direct execFile when the token is in the
 * process env; otherwise shells through `source ~/.flinter/gmi-env.sh` so the
 * Keychain token materializes only inside the child.
 */
export function runGmiTask(script, action, args, opts = {}) {
  const nodeArgs = buildCommand(script, action, args)
  const timeoutMs = opts.timeoutMs ?? ACTION_TIMEOUTS[action]
  const run = (exec, spawnArgs) =>
    new Promise((resolve, reject) => {
      execFile(exec, spawnArgs, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } }, (error, stdout, stderr) => {
        if (error) {
          const err = new Error((stderr || stdout || error.message).toString().trim().slice(0, 2000))
          err.stdout = stdout?.toString() ?? ''
          reject(err)
          return
        }
        resolve(stdout.toString())
      })
    })
  if (process.env.GMI_MANAGEMENT_TOKEN) {
    return run('node', nodeArgs)
  }
  const shellCmd = `source ${quoteShell(GMI_ENV_FILE)} && node ${nodeArgs.map(quoteShell).join(' ')}`
  return run('bash', ['-c', shellCmd])
}

export function agentboxLaunchTool(opts = {}) {
  const script = opts.script ?? process.env.DSH_GMI_SCRIPT_PATH ?? DEFAULT_GMI_SCRIPT
  const run = opts.runGmiTask ?? runGmiTask
  return defineTool({
    name: 'agentbox_launch',
    description:
      'Manage a GMI AgentBox bounded task lifecycle: provision a container, poll it to ' +
      'running, list tasks, smoke-test a live endpoint, or delete (scale-to-zero stops ' +
      'billing). Executes flinter-data-infra gmi-task.mjs primitives. Requires GMI env: ' +
      'GMI_MANAGEMENT_TOKEN in the process env or ~/.flinter/gmi-env.sh (Keychain).',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ACTIONS,
        description: 'Lifecycle action: provision, poll, list, smoke, delete.',
      },
      deployment: {
        type: 'string',
        description: 'Deployment slug (provision/list). Default flinter-segment-stub.',
      },
      template: {
        type: 'string',
        description: 'GMI template id (provision).',
      },
      task_id: {
        type: 'string',
        description: 'AgentBox task id (poll/delete).',
      },
      endpoint: {
        type: 'string',
        description: 'Live container endpoint url (smoke).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          output: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.ok ? (value.output ?? 'ok') : `agentbox error: ${value.error ?? 'unknown'}` }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (exec.signal?.aborted) throw new Error('agentbox_launch aborted before run')
      const env = await gmiEnvStatus()
      if (!env.ready) {
        return {
          ok: false,
          output: '',
          error:
            'GMI environment missing: set GMI_MANAGEMENT_TOKEN (or ensure ~/.flinter/gmi-env.sh ' +
            'exists so the Keychain token can be loaded) before launching AgentBox. ' +
            'No GMI provisioning was attempted.',
        }
      }
      try {
        const stdout = await run(script, args.action, args)
        return { ok: true, output: stdout.trim().slice(0, 4000), error: null }
      } catch (error) {
        return { ok: false, output: '', error: error.message }
      }
    },
  })
}
