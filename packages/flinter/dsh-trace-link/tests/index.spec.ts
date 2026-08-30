import { describe, expect, it } from 'vitest'
import { consumeFlinterNativeSessionEvents } from '@deepseek-ai/dsh-alpha-profile'
import {
  referenceFromSessionEvent,
  traceLinkFromSessionEvent,
} from '../src/index.ts'

describe('public DSH trace-link seam', () => {
  it('links a native event by metadata only', () => {
    const link = traceLinkFromSessionEvent(
      referenceFromSessionEvent({
        sessionId: 'session-1',
        seq: 7,
        type: 'plugin/opaque',
        data: { secretPayload: 'must-not-cross' },
      } as never),
      { organizationId: 'org-1', dshSessionId: 'session-1', executionRunId: 'run-1' },
      {
        linkId: 'link-1',
        executionRecordId: null,
        producer: 'dsh-trace-link',
        producerVersion: '0.1.2-alpha.1',
        codeVersion: 'test-code',
      },
    )
    expect(link).toEqual({
      schema_version: 'flinter.trace-link.v1',
      link_id: 'link-1',
      link_kind: 'dsh_session_event_to_execution',
      organization_id: 'org-1',
      dsh_session_id: 'session-1',
      dsh_event_seq: 7,
      execution_run_id: 'run-1',
      execution_record_id: null,
      producer: 'dsh-trace-link',
      producer_version: '0.1.2-alpha.1',
      code_version: 'test-code',
    })
    expect(JSON.stringify(link)).not.toContain('secretPayload')
  })

  it('projects payload away and rejects extra fields at the reference boundary', () => {
    expect(referenceFromSessionEvent({ sessionId: 'session-1', seq: 1, payload: {} } as never)).toEqual({
      sessionId: 'session-1',
      seq: 1,
    })
    expect(() => traceLinkFromSessionEvent({ sessionId: 'session-1', seq: 1, payload: {} } as never,
      { organizationId: 'org-1', dshSessionId: 'session-1', executionRunId: 'run-1' },
      { linkId: 'link-1', producer: 'test', producerVersion: '1', codeVersion: '1' },
    )).toThrow(/only sessionId and seq/)
    expect(() => traceLinkFromSessionEvent(
      { sessionId: 'session-2', seq: 1 },
      { organizationId: 'org-1', dshSessionId: 'session-1', executionRunId: 'run-1' },
      { linkId: 'link-1', producer: 'test', producerVersion: '1', codeVersion: '1' },
    )).toThrow(/does not match/)
  })

  it('consumes the native alpha event projection without interpreting event data', () => {
    const session = { id: 'session-1' } as never
    const events = [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 0 } },
      { type: 'plugin/opaque', seq: 1, time: 2, data: { opaque: true } },
    ] as never
    const consumed = consumeFlinterNativeSessionEvents(session, events)
    const links = consumed.events.map(event => traceLinkFromSessionEvent(
      referenceFromSessionEvent({ sessionId: consumed.session.id, seq: event.seq }),
      { organizationId: 'org-1', dshSessionId: consumed.session.id, executionRunId: 'run-1' },
      {
        linkId: `link-${event.seq}`,
        producer: 'dsh-trace-link',
        producerVersion: '0.1.2-alpha.1',
        codeVersion: 'test-code',
      },
    ))
    expect(links.map(link => link.dsh_event_seq)).toEqual([0, 1])
    expect(JSON.stringify(links)).not.toContain('opaque')
  })
})
