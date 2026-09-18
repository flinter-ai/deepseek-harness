import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as IdleGuard from '../src/index.ts'
import { collectActivity, createState, isIdle, writeState, type IdleGuardActivity, type IdleGuardState } from '../src/index.ts'

let roots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
  roots = []
})

const quiet: IdleGuardActivity = {
  capabilitiesReady: true,
  lastActivityAt: 1_000,
  activeHttpRequests: 0,
  activeWebSockets: 0,
  activeJobs: 0,
  activePtys: 0,
}

describe('idle guard state', () => {
  it('stays awake while any transport or execution resource is active', () => {
    const state = createState(quiet, 1_000)
    expect(isIdle(state, 31_000, 30_000)).toBe(true)
    for (const key of ['activeHttpRequests', 'activeWebSockets', 'activeJobs', 'activePtys'] as const) {
      expect(isIdle({ ...state, [key]: 1 }, 31_000, 30_000)).toBe(false)
    }
  })

  it('does not stop on invalid clocks or before the threshold', () => {
    const state = createState(quiet, 1_000)
    expect(isIdle(state, 30_999, 30_000)).toBe(false)
    expect(isIdle(state, Number.NaN, 30_000)).toBe(false)
    expect(isIdle(state, 31_000, -1)).toBe(false)
    expect(isIdle(state, 31_000, Number.NaN)).toBe(false)
  })

  it('rejects states from another schema or an incomplete composition', () => {
    const state = createState(quiet, 1_000)
    expect(isIdle({ ...state, schemaVersion: 1 } as unknown as IdleGuardState, 31_000, 30_000)).toBe(false)
    expect(isIdle({ ...state, capabilitiesReady: false }, 31_000, 30_000)).toBe(false)
  })

  it('writes a complete atomically replaceable state document', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-idle-guard-'))
    roots.push(root)
    const path = join(root, 'nested', 'state.json')
    const state = createState(quiet, 2_000)
    await writeState(path, state)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(state)
  })

  it('collects process-wide job and PTY counts instead of owner-visible lists', () => {
    const ctx = new Context()
    ctx.provide('webServer', { activitySnapshot: () => ({
      lastActivityAt: 3_000,
      activeRequests: 1,
      activeWebSockets: 2,
    }) } as never)
    ctx.provide('jobs', { activeCount: () => 3 } as never)
    ctx.provide('terminals', { activeCount: () => 4 } as never)
    expect(collectActivity(ctx)).toEqual({
      capabilitiesReady: true,
      lastActivityAt: 3_000,
      activeHttpRequests: 1,
      activeWebSockets: 2,
      activeJobs: 3,
      activePtys: 4,
    })
  })

  it('counts zero for execution registries that are absent from the composition', () => {
    const ctx = hostContext(() => ({ lastActivityAt: 3_000, activeRequests: 0, activeWebSockets: 0 }))
    const activity = collectActivity(ctx, 'absent')
    expect(activity.capabilitiesReady).toBe(false)
    expect(activity.activeJobs).toBe(0)
    expect(activity.activePtys).toBe(0)
  })

  it('marks an incomplete composition unsafe instead of treating missing counters as idle', () => {
    const ctx = new Context()
    ctx.provide('webServer', { activitySnapshot: () => ({
      lastActivityAt: 3_000,
      activeRequests: 0,
      activeWebSockets: 0,
    }) } as never)
    ctx.provide('jobs', { activeCount: () => 0 } as never)
    expect(collectActivity(ctx).capabilitiesReady).toBe(false)
    expect(isIdle(createState(collectActivity(ctx), 3_000), 33_000, 30_000)).toBe(false)
  })

  it('allows an explicitly PTY-free Web composition to report readiness', () => {
    const ctx = new Context()
    ctx.provide('webServer', { activitySnapshot: () => ({
      lastActivityAt: 3_000,
      activeRequests: 0,
      activeWebSockets: 0,
    }) } as never)
    ctx.provide('jobs', { activeCount: () => 0 } as never)
    expect(collectActivity(ctx, 'absent')).toEqual({
      capabilitiesReady: true,
      lastActivityAt: 3_000,
      activeHttpRequests: 0,
      activeWebSockets: 0,
      activeJobs: 0,
      activePtys: 0,
    })
  })
})

function hostContext(activitySnapshot: () => { lastActivityAt: number; activeRequests: number; activeWebSockets: number }) {
  const ctx = new Context()
  ctx.provide('webServer', { activitySnapshot } as never)
  return ctx
}

describe('idle guard plugin', () => {
  it('writes nothing while disabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-idle-guard-'))
    roots.push(root)
    const ctx = hostContext(() => ({ lastActivityAt: 1_000, activeRequests: 0, activeWebSockets: 0 }))
    const fiber = await ctx.plugin(IdleGuard, { enabled: false, stateFile: join(root, 'state.json') })
    await fiber.dispose()
    await expect(readFile(join(root, 'state.json'), 'utf8')).rejects.toThrow()
  })

  it('publishes an initial state and refreshes it until disposal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-idle-guard-'))
    roots.push(root)
    const stateFile = join(root, 'idle-state.json')
    const ctx = hostContext(() => ({ lastActivityAt: 1_000, activeRequests: 0, activeWebSockets: 0 }))
    ctx.provide('jobs', { activeCount: () => 0 } as never)
    const fiber = await ctx.plugin(IdleGuard, { enabled: true, stateFile, intervalMs: 5, ptyMode: 'absent' })

    const initial = JSON.parse(await readFile(stateFile, 'utf8')) as IdleGuardState
    expect(initial).toMatchObject({
      schemaVersion: 2,
      capabilitiesReady: true,
      lastActivityAt: 1_000,
      activeHttpRequests: 0,
      activeWebSockets: 0,
      activeJobs: 0,
      activePtys: 0,
    })

    await vi.waitFor(async () => {
      const refreshed = JSON.parse(await readFile(stateFile, 'utf8')) as IdleGuardState
      expect(refreshed.observedAt).toBeGreaterThan(initial.observedAt)
    })

    await fiber.dispose()
    const settled = JSON.parse(await readFile(stateFile, 'utf8')) as IdleGuardState
    await new Promise(resolve => setTimeout(resolve, 25))
    expect((JSON.parse(await readFile(stateFile, 'utf8')) as IdleGuardState).observedAt).toBe(settled.observedAt)
  })

  it('applies its own defaults when invoked without schema-parsed config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-idle-guard-'))
    roots.push(root)
    const stateFile = join(root, 'idle-state.json')
    const ctx = hostContext(() => ({ lastActivityAt: 1_000, activeRequests: 0, activeWebSockets: 0 }))
    ctx.provide('jobs', { activeCount: () => 0 } as never)
    ctx.provide('terminals', { activeCount: () => 0 } as never)
    // ctx.plugin applies the Config schema before apply; a direct call proves
    // the defensive fallbacks used by non-schema compositions.
    await IdleGuard.apply(ctx, { enabled: true, stateFile })
    const state = JSON.parse(await readFile(stateFile, 'utf8')) as IdleGuardState
    expect(state.capabilitiesReady).toBe(true)
    await ctx.fiber.dispose()
  })

  it('fails startup when the state file cannot be created', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-idle-guard-'))
    roots.push(root)
    const stateFile = join(root, 'occupied')
    await mkdir(stateFile)
    await writeFile(join(stateFile, 'keep'), 'x')
    const ctx = hostContext(() => ({ lastActivityAt: 1_000, activeRequests: 0, activeWebSockets: 0 }))
    ctx.provide('jobs', { activeCount: () => 0 } as never)
    await expect(ctx.plugin(IdleGuard, { enabled: true, stateFile, ptyMode: 'absent' })).rejects.toThrow()
  })

  it('logs asynchronous publish failures instead of tearing down the host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-idle-guard-'))
    roots.push(root)
    const stateFile = join(root, 'idle-state.json')
    let snapshot = () => ({ lastActivityAt: 1_000, activeRequests: 0, activeWebSockets: 0 })
    const ctx = hostContext(() => snapshot())
    ctx.provide('jobs', { activeCount: () => 0 } as never)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    const fiber = await ctx.plugin(IdleGuard, { enabled: true, stateFile, intervalMs: 5, ptyMode: 'absent' })

    // A non-Error rejection is wrapped before it reaches the logger.
    snapshot = () => { throw 'provider gone' }
    await vi.waitFor(() => { expect(warn).toHaveBeenCalled() })
    const wrapped = warn.mock.calls.at(-1)?.[0]
    expect(wrapped).toBeInstanceOf(Error)
    expect((wrapped as Error).message).toBe('provider gone')

    // An Error rejection reaches the logger unwrapped.
    warn.mockClear()
    const failure = new Error('state write failed')
    snapshot = () => { throw failure }
    await vi.waitFor(() => { expect(warn).toHaveBeenCalled() })
    expect(warn.mock.calls.at(-1)?.[0]).toBe(failure)

    await fiber.dispose()
  })
})
