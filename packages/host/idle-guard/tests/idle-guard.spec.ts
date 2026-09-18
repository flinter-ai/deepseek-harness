import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { collectActivity, createState, isIdle, writeState, type IdleGuardActivity } from '../src/index.ts'

let roots: string[] = []

afterEach(async () => {
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
