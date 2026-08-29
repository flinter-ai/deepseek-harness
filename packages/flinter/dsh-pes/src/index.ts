/** Scaffold-only bounded searchable-trace surface. */

export const SCAFFOLD_STATUS = 'SCAFFOLD_ONLY' as const

export interface PesQuery {
  readonly query: string
  readonly tenantId?: string
}

export interface PesResult {
  readonly status: 'UNKNOWN' | 'MATCH' | 'MISS'
  readonly traceIds: readonly string[]
  readonly provenance: string
}

export interface PesBoundary {
  readonly status: typeof SCAFFOLD_STATUS
  readonly query: (request: PesQuery) => Promise<PesResult>
}
