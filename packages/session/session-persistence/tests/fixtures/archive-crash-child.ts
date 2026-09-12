import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import Sqlite from '@deepseek-ai/dsh-session-persistence-sqlite'

const [backend, root] = process.argv.slice(2)
if ((backend !== 'jsonl' && backend !== 'sqlite') || root === undefined) throw new Error('expected backend and root')
const ctx = new Context()
await ctx.plugin(SessionStore)
if (backend === 'jsonl') await ctx.plugin(Jsonl, { root, compression: 'none' })
else await ctx.plugin(Sqlite, { path: join(root, 'sessions.db') })
const id = SessionId('archive-crash')
const expected: SessionEvent[] = [
  { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
  { type: 'turn/end', seq: 1, time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
  { type: 'plugin/opaque', seq: 2, time: 3, data: { text: '档案', nested: [1, null, true] } } as unknown as SessionEvent,
]
await ctx.sessionPersistence.create({ id, version: SESSION_FORMAT_VERSION, createdAt: 1 })
await ctx.sessionPersistence.append(id, expected)
const snapshot = await ctx.sessionPersistence.beginArchiveSnapshot(id)
if (snapshot === undefined) throw new Error('snapshot absent')
const first = await ctx.sessionPersistence.readArchiveSnapshotPage(snapshot, -1, 1)
await writeFile(join(root, 'checkpoint.json'), JSON.stringify({ snapshot, first, expected }))
await ctx.sessionPersistence.append(id, [{ type: 'turn/start', seq: 3, time: 4, data: { turn: 2 } }])
await writeFile(join(root, 'ready'), 'checkpoint-and-suffix-written')
// Parent kills this process without Context disposal or database close.
setInterval(() => {}, 1000)
