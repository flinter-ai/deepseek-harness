#!/usr/bin/env node
/**
 * Engine-shaped fixture that honestly ABSTAINS for every search request —
 * TEST FIXTURE ONLY.
 *
 * Re-implements just the abstention half of the documented
 * `event_index.query` stdin JSONL protocol: one request object per line ->
 * one response object per line, with `abstained: true`, empty event arrays,
 * and exit 0. Lets the runtime driver's abstention exit be exercised
 * keylessly without touching the real engine or its corpus semantics.
 */

import { readFileSync } from 'node:fs'

const input = readFileSync(0, 'utf8')
for (const line of input.split('\n')) {
  if (line.trim() === '') continue
  const request = JSON.parse(line)
  process.stdout.write(`${JSON.stringify({
    mode: request.mode,
    count: 0,
    event_ids: [],
    events: [],
    abstained: true,
    n: request.n,
    ...(request.mode === 'search' ? { query: request.query } : {}),
  })}\n`)
}
process.exit(0)
