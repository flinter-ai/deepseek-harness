#!/usr/bin/env node
/**
 * Engine-shaped fixture that exceeds a bounded deadline: waits 1500ms then
 * emits a protocol-valid response. Used by the seam tests with a small
 * configured timeoutMs to pin the engine-timeout structured result.
 */

setTimeout(() => {
  process.stdout.write(`${JSON.stringify({
    mode: 'search', count: 0, event_ids: [], abstained: false, events: [], n: 3, query: 'slow',
  })}\n`)
  process.exit(0)
}, 1500)