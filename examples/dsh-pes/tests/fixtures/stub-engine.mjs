#!/usr/bin/env node
/**
 * Protocol-compatible stub of the searchable-trace query CLI
 * (`event_index.query` stdin JSON-lines mode) — TEST FIXTURE ONLY.
 *
 * This is NOT the engine and never imports it: it re-implements the documented
 * request/response contract so the plugin's command seam can be exercised
 * keylessly. Behavior mirrors the real CLI where it matters for the plugin:
 *   - argv: `--events PATH` (mode omitted -> stdin JSONL mode)
 *   - one request object per line -> one response object per line
 *   - response envelope: {mode, count, event_ids, abstained, events, <echo>}
 *   - per-request error objects: {"error": ...} / {"line", "error"}
 *   - exit 0 all ok, exit 1 any request failed
 *   - n clamped to the corpus; n < 1 rejected; unknown mode rejected
 *   - honest abstention: similar abstains when no pre-state is annotated,
 *     counterfactual abstains when no event carries an outcome
 *   - deterministic output: canonical (sorted-key) JSON, stable ordering
 */

import { readFileSync } from 'node:fs'

const MODES = ['search', 'similar', 'counterfactual', 'zoom']
const DEFAULT_N = 3

function parseArgv(argv) {
  let eventsPath = null
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--events') {
      i += 1
      eventsPath = argv[i]
    }
  }
  if (eventsPath === null) {
    throw new Error('stub engine: --events PATH is required')
  }
  return eventsPath
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key])
    return out
  }
  return value
}

function render(event) {
  const before = event.state_before ?? { holding: [], on_surface: [] }
  const after = event.state_after ?? { holding: [], on_surface: [] }
  const tokens = []
  for (const rel of ['holding', 'on_surface']) {
    for (const item of before[rel] ?? []) tokens.push(item)
    for (const item of after[rel] ?? []) tokens.push(item)
  }
  return `${event.event_id} ${event.episode_id} ${event.transition_type} ${tokens.join(' ')} ${event.outcome ?? ''}`
}

function tokenize(text) {
  return (String(text).toLowerCase().match(/[a-z0-9_]+/g) ?? []).sort()
}

function clampN(raw, corpusSize) {
  const n = Number(raw ?? DEFAULT_N)
  if (!Number.isInteger(n)) return { problem: `n must be an int, got ${JSON.stringify(raw)}` }
  if (n < 1) return { problem: `n must be >= 1, got ${n}` }
  return { n: Math.min(n, corpusSize) }
}

function stateOf(holding, onSurface) {
  if (!Array.isArray(holding) || !Array.isArray(onSurface)
    || ![...holding, ...onSurface].every(item => typeof item === 'string')) {
    return { problem: 'holding/on_surface must be JSON arrays of strings' }
  }
  return { state: { holding: [...new Set(holding)].sort(), on_surface: [...new Set(onSurface)].sort() } }
}

function symmetricDelta(a, b) {
  let d = 0
  for (const rel of ['holding', 'on_surface']) {
    const left = new Set(a[rel] ?? [])
    const right = new Set(b[rel] ?? [])
    d += [...new Set([...left, ...right])].filter(item => left.has(item) !== right.has(item)).length
  }
  return d
}

function dispatch(req, events) {
  const mode = req.mode
  if (!MODES.includes(mode)) {
    return { mode, error: `unknown mode ${JSON.stringify(mode)}; expected one of ${MODES.join(', ')}` }
  }
  const clamped = clampN(req.n, events.length)
  if (clamped.problem) return { mode, error: clamped.problem }
  const n = clamped.n

  if (mode === 'search') {
    const query = req.query
    if (typeof query !== 'string' || query.trim() === '') {
      return { mode, error: "search requires a non-empty 'query' string" }
    }
    const queryTokens = tokenize(query)
    const scored = events.map(event => ({
      event,
      score: tokenize(render(event)).filter(token => queryTokens.includes(token)).length,
    }))
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.event.event_id < b.event.event_id ? -1 : 1
    })
    const picked = scored.slice(0, n).map(entry => entry.event)
    return { mode, count: picked.length, event_ids: picked.map(e => e.event_id), abstained: false, events: picked, n, query }
  }

  if (mode === 'similar' || mode === 'counterfactual') {
    const parsed = stateOf(req.holding ?? [], req.on_surface ?? [])
    if (parsed.problem) return { mode, error: parsed.problem }
    const state = parsed.state
    const abstained = events.every(event => event.state_before == null)
    let scored = events
      .filter(event => event.state_before != null)
      .map(event => ({
        event,
        delta: symmetricDelta(state, event.state_before),
        id: event.event_id,
      }))
    if (mode === 'counterfactual') {
      const outcome = req.outcome
      if (typeof outcome !== 'string' || outcome.trim() === '') {
        return { mode, error: "counterfactual requires a non-empty 'outcome' string" }
      }
      scored = scored.filter(entry => entry.event.outcome != null && entry.event.outcome !== outcome)
      scored.sort((a, b) => a.delta - b.delta || (a.id < b.id ? -1 : 1))
      const picked = scored.slice(0, n).map(entry => entry.event)
      return {
        mode, count: picked.length, event_ids: picked.map(e => e.event_id), abstained, events: picked, n,
        state, outcome,
      }
    }
    scored.sort((a, b) => a.delta - b.delta || (a.id < b.id ? -1 : 1))
    const picked = scored.slice(0, n).map(entry => entry.event)
    return { mode, count: picked.length, event_ids: picked.map(e => e.event_id), abstained, events: picked, n, state }
  }

  if (mode === 'zoom') {
    const episode = req.episode
    if (typeof episode !== 'string' || episode.trim() === '') {
      return { mode, error: "zoom requires a non-empty 'episode' string" }
    }
    const tStart = Number(req.t_start)
    const tEnd = Number(req.t_end)
    if (!Number.isInteger(tStart) || !Number.isInteger(tEnd)) {
      return { mode, error: 'zoom requires int t_start and t_end' }
    }
    if (tStart < 0 || tEnd < tStart) return { mode, error: 'zoom requires 0 <= t_start <= t_end' }
    const picked = events
      .filter(event => event.episode_id === episode && event.t_end >= tStart && event.t_start <= tEnd)
      .slice(0, n)
    return {
      mode, count: picked.length, event_ids: picked.map(e => e.event_id), abstained: false, events: picked, n,
      episode, t_start: tStart, t_end: tEnd,
    }
  }

  return { mode, error: `unhandled mode ${JSON.stringify(mode)}` }
}

const eventsPath = parseArgv(process.argv.slice(2))
const events = readFileSync(eventsPath, 'utf8')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line !== '')
  .map(line => JSON.parse(line))

let failures = 0
const input = readFileSync(0, 'utf8')
for (const [lineNo, line] of input.split('\n').entries()) {
  if (line.trim() === '') continue
  let req
  try {
    req = JSON.parse(line)
  } catch (error) {
    failures += 1
    process.stdout.write(`${JSON.stringify(canonical({ line: lineNo + 1, error: `malformed JSON line: ${error.message}` }))}\n`)
    continue
  }
  const response = dispatch(req, events)
  failures += Number(Object.prototype.hasOwnProperty.call(response, 'error'))
  process.stdout.write(`${JSON.stringify(canonical(response))}\n`)
}
process.exit(failures > 0 ? 1 : 0)