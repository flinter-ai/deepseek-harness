/**
 * @flinter/dsh-pes tool result rendering — a pure function of the result
 * envelope, so the UI render intent stays part of the tool design (generic
 * text lines) without touching the execution path.
 */

/**
 * One-line text render for a bounded tool result.
 * @param args - the tool arguments (unused by the render).
 * @param value - the structured result envelope.
 * @returns the text-render line array for the tools registry.
 */
export function renderPesResult(_args, value) {
  const status = typeof value?.status === 'string' ? value.status : 'error'
  const count = typeof value?.count === 'number' ? value.count : 0
  const mode = typeof value?.mode === 'string' ? value.mode : '?'
  const headline = `${value?.tool ?? 'dsh-pes'} → ${status} (${mode}, ${count} event(s))`
  if (status === 'error') {
    const detail = value?.error?.message ?? 'structured engine error'
    return [{ type: 'text', text: `${headline}: ${detail}` }]
  }
  const ids = Array.isArray(value?.event_ids) && value.event_ids.length > 0
    ? value.event_ids.slice(0, 3).join(', ')
    : '(none)'
  return [{ type: 'text', text: `${headline} — ${ids}` }]
}
