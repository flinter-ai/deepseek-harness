import { describe, expect, it } from 'vitest'
import { validateSegmentEnvelope } from '../src/index.ts'

const base = { capability_id: 'towert.segment.v1', output_schema_version: 'segment-v1' }

describe('public TowerT segment boundary', () => {
  it('preserves a completed empty result as a valid measured result', () => {
    expect(validateSegmentEnvelope({ ...base, status: 'completed', candidates: [], classifications: [] })).toMatchObject({ status: 'completed' })
  })

  it('keeps partial and abstention semantics explicit', () => {
    expect(validateSegmentEnvelope({ ...base, status: 'partial', candidates: [], classifications: [], partial: { reason: 'classifier unavailable', missing_components: ['classifications'] } })).toMatchObject({ status: 'partial' })
    expect(validateSegmentEnvelope({ ...base, status: 'completed', candidates: [{ candidate_id: 'cand_12345678' }], classifications: [{ candidate_id: 'cand_12345678', action_family: 'UNKNOWN', abstained: true, abstain_reason: 'insufficient evidence' }] })).toMatchObject({ status: 'completed' })
  })

  it('rejects failed output that fabricates scientific records', () => {
    expect(() => validateSegmentEnvelope({ ...base, status: 'failed', candidates: [{ candidate_id: 'cand_12345678' }], classifications: [], failure: { message: 'timeout', retriable: true } })).toThrow(/no scientific output/)
  })
})
