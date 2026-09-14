/**
 * Host-side activity state for an external idle-stop controller. The plugin
 * records no request bodies, credentials, session labels, or user content. It
 * only publishes bounded counters and a monotonic activity timestamp to an
 * operator-owned state file; a deployment-specific systemd timer decides
 * whether stopping the host is safe.
 *
 * @module @deepseek-ai/dsh-host-idle-guard
 */

import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-terminal'

/** Stable Cordis plugin name. */
export const name = 'idle-guard'

/** The transport is required; execution providers are discovered defensively. */
export const inject = ['webServer']

/** Redacted live activity facts used by the state writer and tests. */
export interface IdleGuardActivity {
  /** True only when every known execution counter is available. */
  readonly capabilitiesReady: boolean
  readonly lastActivityAt: number
  readonly activeHttpRequests: number
  readonly activeWebSockets: number
  readonly activeJobs: number
  readonly activePtys: number
}

/** Whether the composed host must provide a PTY registry. */
export type IdleGuardPtyMode = 'required' | 'absent'

/** Versioned state file written for the deployment-level idle controller. */
export interface IdleGuardState extends IdleGuardActivity {
  readonly schemaVersion: 2
  readonly observedAt: number
}

/** Idle guard configuration. The plugin is disabled unless explicitly enabled. */
export interface Config {
  /** Write the state file and keep it fresh. Defaults to false. */
  enabled?: boolean
  /** Absolute state-file path owned by the host deployment. */
  stateFile?: string
  /** State refresh period in milliseconds. Defaults to 30 seconds. */
  intervalMs?: number
  /** Declare whether a missing PTY registry is expected in this composition. */
  ptyMode?: IdleGuardPtyMode
}

const DEFAULT_STATE_FILE = '/var/lib/dsh-phase2/idle-state.json'
const DEFAULT_INTERVAL_MS = 30_000

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  stateFile: z.string().default(DEFAULT_STATE_FILE),
  intervalMs: z.natural().min(1).default(DEFAULT_INTERVAL_MS),
  ptyMode: z.union([z.const('required'), z.const('absent')]).default('required'),
})

/**
 * Compose the current process-wide activity snapshot without exposing content.
 * @param ctx - Host context providing Web activity and optional execution registries.
 * @param ptyMode - Whether a missing PTY registry is an expected composition fact.
 * @returns redacted counters and capability readiness for the current process.
 */
export function collectActivity(ctx: Context, ptyMode: IdleGuardPtyMode = 'required'): IdleGuardActivity {
  const web = ctx.webServer.activitySnapshot()
  // Use the reflection service directly: the plugin intentionally does not
  // declare optional execution dependencies, so proxy property access would
  // throw for a minimal Web composition that has no `jobs` or `terminals`.
  const jobs = ctx.reflect.get('jobs') as { activeCount(): number } | undefined
  const terminals = ctx.reflect.get('terminals') as { activeCount(): number } | undefined
  return {
    capabilitiesReady: jobs !== undefined && (terminals !== undefined || ptyMode === 'absent'),
    lastActivityAt: web.lastActivityAt,
    activeHttpRequests: web.activeRequests,
    activeWebSockets: web.activeWebSockets,
    activeJobs: jobs?.activeCount() ?? 0,
    activePtys: terminals?.activeCount() ?? 0,
  }
}

/**
 * Create a versioned state record at one observation timestamp.
 * @param activity - Redacted live activity values to persist.
 * @param observedAt - Timestamp associated with this observation.
 * @returns the versioned idle-guard state record.
 */
export function createState(activity: IdleGuardActivity, observedAt = Date.now()): IdleGuardState {
  return {
    schemaVersion: 2,
    observedAt,
    ...activity,
  }
}

/**
 * Return true only when every known live resource is quiescent for the threshold.
 * @param state - Versioned state to evaluate.
 * @param now - Current timestamp in the same units as the state timestamps.
 * @param idleAfterMs - Required quiet period in milliseconds.
 * @returns true only when the state is complete, quiescent, and old enough.
 */
export function isIdle(state: IdleGuardState, now: number, idleAfterMs: number): boolean {
  if (!Number.isFinite(now) || !Number.isFinite(idleAfterMs) || idleAfterMs < 0) return false
  if (state.schemaVersion !== 2 || state.capabilitiesReady !== true) return false
  if (state.activeHttpRequests !== 0
    || state.activeWebSockets !== 0
    || state.activeJobs !== 0
    || state.activePtys !== 0) return false
  return now >= state.lastActivityAt + idleAfterMs
}

/**
 * Atomically replace a state file, leaving no partially written JSON for readers.
 * @param path - Host-owned state-file path.
 * @param state - Redacted state record to write.
 * @returns a promise settled after the atomic replacement.
 */
export async function writeState(path: string, state: IdleGuardState): Promise<void> {
  const parent = dirname(path)
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  await mkdir(parent, { recursive: true, mode: 0o750 })
  try {
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o640 })
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

/** Start the opt-in state writer. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (config.enabled !== true) return

  const stateFile = config.stateFile ?? DEFAULT_STATE_FILE
  const intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS
  const ptyMode = config.ptyMode ?? 'required'
  let pending = Promise.resolve()
  const publish = (): void => {
    pending = pending.then(async () => {
      await writeState(stateFile, createState(collectActivity(ctx, ptyMode)))
    }).catch((error: unknown) => {
      ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
    })
  }

  // Fail startup if the enabled guard cannot create its state file. A stale or
  // missing state file must never be interpreted by the shutdown controller as
  // proof that the host is idle.
  await writeState(stateFile, createState(collectActivity(ctx, ptyMode)))
  const timer = setInterval(publish, intervalMs)
  timer.unref()
  ctx.effect(() => async () => {
    clearInterval(timer)
    await pending
  }, 'idle-guard state writer')
}

export default apply
