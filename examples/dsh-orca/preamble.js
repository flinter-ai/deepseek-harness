/**
 * Parse Orca's injected dispatch preamble.
 *
 * When `orca orchestration dispatch --inject` sends a task into a bare
 * terminal, it prints a structured preamble that contains the coordinator
 * handle, task ID, dispatch ID, and the task spec. This module extracts those
 * values from plain text so a DSH worker shim can set the DSH_ORCA_* context
 * and pass only the task spec to the harness agent.
 *
 * Example preamble (abbreviated):
 *
 *   You are working inside Orca, a multi-agent IDE. You are a dispatched worker.
 *   Your coordinator's terminal handle is: term_xxxxxxxx
 *   Your task ID is: task_xxxxxxxx
 *
 *   === CLI COMMANDS ===
 *     orca orchestration send --from term_xxxxxxxx \
 *       --type worker_done --subject "..." \
 *       --body "..." \
 *       --task-id task_xxxxxxxx --dispatch-id ctx_xxxxxxxx --outcome succeeded
 *
 *   === TASK ===
 *   Refactor the error handling module.
 */

/** Regexes for the fixed fields in the preamble. */
const PATTERNS = {
  coordinator: /Your coordinator's terminal handle is:\s*(\S+)/,
  taskId: /Your task ID is:\s*(\S+)/,
  dispatchId: /--dispatch-id\s+(\S+)/,
}

/**
 * Try to parse an Orca dispatch preamble.
 * @param {string} text - the raw text injected into the terminal.
 * @returns {object|null} - { coordinator, taskId, dispatchId, taskSpec } or null if not a preamble.
 */
export function parseOrcaPreamble(text) {
  if (typeof text !== 'string' || text.length === 0) return null

  // Quick rejection: must contain the Orca preamble header.
  if (!text.includes('You are working inside Orca')) return null

  const coordinator = matchGroup(text, PATTERNS.coordinator)
  const taskId = matchGroup(text, PATTERNS.taskId)
  const dispatchId = matchGroup(text, PATTERNS.dispatchId)
  const taskSpec = extractTaskSpec(text)

  // All four fields must be present for a valid preamble.
  if (!coordinator || !taskId || !dispatchId || taskSpec === undefined) return null

  return { coordinator, taskId, dispatchId, taskSpec }
}

function matchGroup(text, pattern) {
  const match = text.match(pattern)
  return match?.[1] ?? null
}

/**
 * Extract the task spec from the `=== TASK ===` block.
 * The task spec is everything after the marker, trimmed.
 */
function extractTaskSpec(text) {
  const marker = '=== TASK ==='
  const index = text.indexOf(marker)
  if (index === -1) return undefined
  const after = text.slice(index + marker.length)
  // Strip a single leading newline and trailing whitespace.
  const trimmed = after.replace(/^\n?/, '').trimEnd()
  return trimmed.length > 0 ? trimmed : undefined
}
