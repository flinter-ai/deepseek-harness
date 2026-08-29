/** Scaffold-only segment compatibility surface; no scientific interpretation. */

export const SCAFFOLD_STATUS = 'SCAFFOLD_ONLY' as const

export interface SegmentEvidence {
  readonly sourceEventId: string
  readonly value: unknown
  readonly provenance: string
  readonly abstained: boolean
}

export interface SegmentBoundary {
  readonly status: typeof SCAFFOLD_STATUS
  readonly evaluate: (evidence: readonly SegmentEvidence[]) => unknown
}
