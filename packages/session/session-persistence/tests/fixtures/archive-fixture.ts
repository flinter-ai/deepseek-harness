import type { SessionArchiveEvent } from '../../src/index.ts'

/** Approved synthetic/redacted ARCH-02 event fixture; no provider or tenant data. */
export const ARCHIVE_FIXTURE: readonly SessionArchiveEvent[] = [
  { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
  { type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } },
  {
    type: 'assistant/chunk', seq: 2, time: 3,
    data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'R1' } },
  },
  {
    type: 'assistant/chunk', seq: 3, time: 4,
    data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'R2' } },
  },
  {
    type: 'assistant/message', seq: 4, time: 5,
    data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'redacted' }] } },
  },
  { type: 'tool/call', seq: 5, time: 6, data: { turn: 1, step: 1, callId: 'call-redacted', name: 'read', arguments: '{}' } },
  { type: 'tool/result', seq: 6, time: 7, data: { turn: 1, step: 1, callId: 'call-redacted', content: 'redacted', isError: false } },
  {
    type: 'assistant/chunk', seq: 7, time: 8,
    data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'R3' } },
  },
  { type: 'plugin/opaque', seq: 8, time: 9, data: { plugin: 'redacted', payload: { preserve: true } } },
  {
    type: 'assistant/message', seq: 9, time: 10,
    data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } },
  },
  { type: 'step/end', seq: 10, time: 11, data: { turn: 1, step: 1 } },
  { type: 'turn/end', seq: 11, time: 12, data: { turn: 1, reason: { kind: 'completed' } } },
]
