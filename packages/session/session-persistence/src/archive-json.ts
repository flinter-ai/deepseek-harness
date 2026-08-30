/**
 * Serialize archive values deterministically without making object-key order
 * part of the logical event-stream identity.
 *
 * The archive snapshot hash and the compressed segment codec must use the same
 * representation; keeping this helper private to the persistence package
 * prevents the two archive layers from drifting.
 * @param value - The JSON-compatible archive value to serialize.
 * @returns The deterministic JSON representation.
 */
export function canonicalArchiveJson(value: unknown): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string': return JSON.stringify(value)
    case 'boolean': return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('archive event contains a non-finite number')
      return JSON.stringify(value)
    case 'object':
      if (Array.isArray(value)) return `[${value.map(canonicalArchiveJson).join(',')}]`
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalArchiveJson((value as Record<string, unknown>)[key])}`).join(',')}}`
    default:
      throw new TypeError('archive event contains a non-JSON value')
  }
}
