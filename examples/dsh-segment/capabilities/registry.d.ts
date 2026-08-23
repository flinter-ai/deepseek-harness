/**
 * Declarations for the plain-JS capability registry consumed by the TS test
 * surface; the runtime contract lives in registry.js.
 */

export interface CapabilityAdapter<Request = unknown, Result = unknown> {
  execute(request: Request): Result | Promise<Result>
}

export interface CapabilityRegistry {
  register<Request = unknown, Result = unknown>(
    id: string,
    adapter: CapabilityAdapter<Request, Result>,
  ): () => void
  has(id: string): boolean
  list(): string[]
  execute<Request = unknown, Result = unknown>(
    id: string,
    request: Request,
  ): Result | Promise<Result>
}

export function createCapabilityRegistry(): CapabilityRegistry
