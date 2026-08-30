import { describe, expect, it } from 'vitest'
import { projectAgenticControl, validateAgenticControlRequest } from '../src/index.ts'

const context = { organizationId: 'org-1', dshSessionId: 'session-1', executionRunId: 'run-1' }

describe('public agentic-control seam', () => {
  it('projects native lifecycle state without copying event payloads', () => {
    const projection = projectAgenticControl(context, [
      { type: 'session', seq: 0, data: { prompt: 'private' } },
      { type: 'turn/start', seq: 1, data: { turn: 0 } },
      { type: 'step/start', seq: 2, data: { step: 0 } },
      { type: 'plugin/opaque', seq: 3, data: { secret: 'private' } },
    ])
    expect(projection).toMatchObject({ highWatermarkSeq: 3, phase: 'step-active', activeTurn: 0, activeStep: 0 })
    expect(JSON.stringify(projection)).not.toContain('private')
  })

  it('uses a cursor to fail closed on stale control requests', () => {
    const projection = projectAgenticControl(context, [{ type: 'turn/end', seq: 4, data: { turn: 0 } }])
    expect(validateAgenticControlRequest(
      { intent: 'interrupt', dshSessionId: 'session-1', expectedSeq: 4 }, context, projection,
    )).toMatchObject({ intent: 'interrupt' })
    expect(() => validateAgenticControlRequest(
      { intent: 'resume', dshSessionId: 'session-1', expectedSeq: 3 }, context, projection,
    )).toThrow(/stale/)
  })
})
