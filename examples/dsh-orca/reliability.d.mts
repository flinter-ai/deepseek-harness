export const DEFAULT_DSH_ROOT: string
export const DEFAULT_ARTIFACT_ROOT: string

export interface AttemptOptions {
  root?: string
  artifactRoot?: string
  runId: string
  taskId: string
  dispatchId: string
}

export interface AttemptPaths {
  home: string
  artifacts: string
}

export function attemptPaths(options: AttemptOptions): AttemptPaths
export function createAttemptPaths(options: AttemptOptions): AttemptPaths
export function writeLaunchManifest(paths: AttemptPaths, metadata: Record<string, unknown>): Record<string, unknown>
export function assertCanaryProof(path: string): string
export function cleanupAttempt(paths: Pick<AttemptPaths, 'home'>, options?: { fenced?: boolean }): void
export function fenceDispatch(
  dispatchId: string,
  options?: {
    abandon?: boolean
    retryRequest?: string
    exec?: (file: string, args: string[], options?: Record<string, unknown>) => string
  },
): { dispatchId: string; state: string; fenced: boolean; action: string; result?: unknown }
