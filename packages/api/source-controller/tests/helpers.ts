import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, {
  SESSION_FORMAT_VERSION,
  SessionId,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { ApiSessionNotFound } from '@deepseek-ai/dsh-api-session-controller'
import SourceController, { type SourcePublisher } from '../src/index.ts'

export interface SourceTestSession {
  readonly id: SessionId
  readonly meta: SessionHeader
}

export interface SourceTestHarness {
  readonly ctx: Context
  readonly root: string
  readonly session: SourceTestSession
  readonly bootSession: (id?: string, createdAt?: number) => SourceTestSession
  readonly dispose: () => Promise<void>
}

export async function setupHarness(options: {
  readonly publisher?: SourcePublisher
  readonly root?: string
} = {}): Promise<SourceTestHarness> {
  const root = options.root ?? await mkdtemp(join(tmpdir(), 'dsh-source-controller-test-'))
  const sessions = new Map<SessionId, SessionHeader>()
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  ctx.provide('sessionController', {
    async inspect(sessionId: SessionId) {
      const meta = sessions.get(sessionId)
      if (meta === undefined) throw new ApiSessionNotFound()
      return { meta, events: [] }
    },
  } as never)
  if (options.publisher !== undefined) ctx.provide('sourcePublisher', options.publisher)
  const controller = await ctx.plugin(SourceController)
  if (controller === undefined) throw new Error('source controller failed to load')

  function bootSession(id = 'source-test-session', createdAt = 1_700_000_000_000): SourceTestSession {
    const sessionId = SessionId(id)
    const meta: SessionHeader = {
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt,
      cwd: root,
    }
    sessions.set(sessionId, meta)
    return { id: sessionId, meta }
  }

  const session = bootSession()
  return {
    ctx,
    root,
    session,
    bootSession,
    async dispose() {
      await ctx.fiber.dispose()
      if (options.root === undefined) await rm(root, { recursive: true, force: true })
    },
  }
}
