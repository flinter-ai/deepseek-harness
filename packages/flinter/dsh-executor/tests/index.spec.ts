import { describe, expect, it } from 'vitest'
import { buildRuntaTaskDelivery, replacementAttempt } from '../src/index.ts'

const lineage = { taskId: 'task-1', sessionId: 'session-1', sessionRoot: '/sessions/session-1', attempt: 0, leaseGeneration: 4 }

describe('public executor/Runta boundary', () => {
  it('delivers literal argv with shell disabled and durable session identity', () => {
    const delivery = buildRuntaTaskDelivery({ ...lineage, argv: ['dsh', '--resume', 'session-1', 'literal;not-shell'] })
    expect(delivery.shell).toBe(false)
    expect(delivery.envelope.argv).toContain('literal;not-shell')
    expect(delivery.lineage.sessionRoot).toBe('/sessions/session-1')
  })

  it('advances retry lineage without changing the DSH session/root', () => {
    const replacement = replacementAttempt(lineage, 5)
    expect(replacement).toMatchObject({ attempt: 1, previousAttempt: 0, leaseGeneration: 5, sessionId: 'session-1', sessionRoot: '/sessions/session-1' })
    expect(() => replacementAttempt(lineage, 4)).toThrow(/must advance/)
  })

  it('rejects shell-injection-shaped NUL arguments', () => {
    expect(() => buildRuntaTaskDelivery({ ...lineage, argv: ['dsh\u0000--resume'] })).toThrow(/literal/)
  })
})
