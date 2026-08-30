export type NodeVersion = {
  major: number
  minor: number
  patch: number
}

export function parseNodeVersion(version: string): NodeVersion
export function satisfiesNodeEngine(version: NodeVersion, engine: string): boolean
export function readNodeEngine(root?: string): string
export function verifyNodeRuntime(version?: string, root?: string): { version: string; engine: string }
