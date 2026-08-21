/**
 * Minimal semantic-capability registry for @flinter/dsh-segment.
 *
 * Maps a capability id to its adapter. S1 registers exactly one capability
 * (RUN_BASELINE_PHYSICS); unknown ids fail loudly and no id is listed before
 * its adapter is registered, so nothing looks callable unless it is.
 * register() returns the disposer, matching the repository rule that
 * registrations are effects.
 */

export function createCapabilityRegistry() {
  const adapters = new Map()

  function validateId(id) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError(`capability id must be a non-empty string, got ${JSON.stringify(id)}`)
    }
  }

  return {
    register(id, adapter) {
      validateId(id)
      if (adapters.has(id)) throw new Error(`capability ${JSON.stringify(id)} is already registered`)
      if (adapter === undefined || typeof adapter.execute !== 'function') {
        throw new TypeError(`capability ${JSON.stringify(id)} requires an adapter with an execute(request) method`)
      }
      adapters.set(id, adapter)
      return () => adapters.delete(id)
    },
    has(id) {
      validateId(id)
      return adapters.has(id)
    },
    list() {
      return [...adapters.keys()]
    },
    execute(id, request) {
      const adapter = adapters.get(id)
      if (adapter === undefined) {
        const registered = [...adapters.keys()].join(', ') || '(none)'
        throw new Error(`unknown capability ${JSON.stringify(id)}; registered: ${registered}`)
      }
      return adapter.execute(request)
    },
  }
}
