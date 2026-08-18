/**
 * @flinter/dsh-orca — Orca orchestration bridge for DeepSeek Harness agents.
 *
 * Architecture decision A: Orca + DSH form the FLINTER delivery/ops/verification
 * orchestration layer. Agents operate the workflow; the durable SDK owns it.
 * This plugin makes harness agents first-class Orca workers:
 *
 *   - worker_done        — agent signals completion; routes to the Dispatch's Run
 *   - orca_check_inbox   — agent reads coordinator messages from the run mailbox
 *   - orca_ask           — agent asks the coordinator a blocking question
 *   - agentbox_launch    — agent provisions/polls a GMI AgentBox bounded task
 *   - lifecycle hook     — safety net: if the agent ends WITHOUT an explicit
 *                          worker_done, auto-sends `outcome: failed` with an
 *                          AUTO-INCOMPLETE marker (NEVER claims success)
 *
 * Authority rule: DSH is an EXECUTION harness, not an orchestrator. It may own
 * ephemeral, in-session, non-durable fan-out (the native `subagent` tool). It
 * must NEVER own durable DAG/queue/lease/canonical authority — Workflow, Task
 * SDK, Fargate, TowerN, and Orca's dispatch state all sit ABOVE DSH.
 *
 * Context arrives via the launch environment:
 *   DSH_ORCA_RUN_ID, DSH_ORCA_TASK_ID, DSH_ORCA_DISPATCH_ID, DSH_ORCA_COORDINATOR
 *
 * v1 transport: spawns the `orca` CLI (RPC to the local daemon). v2 (future):
 * talk to the Orca daemon socket directly.
 */

export const name = 'dsh-orca'
export const inject = ['tools']

/** Plugin configuration schema (kept minimal; harness defaults apply). */
export const Config = null

import { workerDoneTool } from './worker-done.js'
import { installLifecycleHook } from './lifecycle.js'
import { orcaCheckInboxTool } from './inbox.js'
import { orcaAskTool } from './ask.js'
import { agentboxLaunchTool } from './agentbox.js'
import { installHeartbeat, orcaHeartbeatTool } from './heartbeat.js'

export function apply(ctx, config = {}) {
  ctx.tools.register(workerDoneTool())
  ctx.tools.register(orcaCheckInboxTool())
  ctx.tools.register(orcaAskTool())
  ctx.tools.register(orcaHeartbeatTool())
  ctx.tools.register(agentboxLaunchTool())
  installLifecycleHook(ctx)
  installHeartbeat(ctx)
  const logger = ctx.logger
  if (logger) logger.info('[dsh-orca] plugin loaded: worker_done, orca_check_inbox, orca_ask, orca_heartbeat, agentbox_launch, lifecycle + heartbeat hooks')
}
