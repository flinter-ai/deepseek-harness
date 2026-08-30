import { describe, expect, it } from 'vitest'
import { assertTenantScope, searchableTraceIdFor, validateSearchableTraceRecord } from '../src/index.ts'

const input = {
  organizationId: 'org-1', projectId: 'project-1', episodeId: 'episode-1', jobId: 'job-1', irId: 'ir-1', runOrdinal: 0,
  jobOutputId: 'output-1', artifactId: 'artifact-1', traceKind: 'execution', summaryText: 'bounded summary', producerSha: 'abcdef1234567',
}

describe('public searchable-trace contract seam', () => {
  it('creates deterministic bounded records', () => {
    const record = validateSearchableTraceRecord(input)
    expect(record.id).toBe(searchableTraceIdFor(input))
    expect(record.schemaVersion).toBe('1')
    expect(record.summaryText).toBe('bounded summary')
  })

  it('rejects oversized summaries and cross-tenant reads', () => {
    expect(() => validateSearchableTraceRecord({ ...input, summaryText: 'x'.repeat(2_001) })).toThrow(/oversized/)
    const record = validateSearchableTraceRecord(input)
    expect(() => assertTenantScope('org-2', record)).toThrow(/organization boundary/)
  })

  it('does not silently accept unknown fields', () => {
    expect(() => validateSearchableTraceRecord({ ...input, payload: 'not inline' } as never)).toThrow(/unknown/)
  })
})
