/**
 * Failure classifier for the DSH-Orca worker launcher.
 *
 * Decides whether a primary-model failure is eligible for the configured
 * fallback retry. Keep this in sync with the routing policy: the acceptance
 * test for `easy` relies on transport/finish-reason failures being retried,
 * while `NO_ADAPTER` and local configuration errors surface immediately.
 */

/**
 * Whether a failed DSH launch should retry with the fallback model.
 *
 * Eligible: provider-side quota/balance/credit errors, HTTP status signals
 * (429/404), auth errors, unsupported-model errors, and transport/stream
 * failures (`stream ended`, `finish_reason`, `transport`).
 *
 * Not eligible: `NO_ADAPTER` (the adapter path itself is missing or the route
 * failed to register) and local configuration errors — retrying the same
 * broken config under a different model id cannot help.
 *
 * @param {string} [stderr] - combined stdout/stderr captured from the launch.
 * @returns {boolean} true when the fallback should be attempted.
 */
export function isProviderError(stderr) {
  const text = (stderr ?? '').toLowerCase()
  return text.includes('quota') ||
    text.includes('insufficient balance') ||
    text.includes('credit') ||
    text.includes('429') ||
    text.includes('404') ||
    text.includes('unauthorized') ||
    text.includes('api key') ||
    text.includes('invalid model') ||
    text.includes('not supported') ||
    text.includes('stream ended') ||
    text.includes('transport') ||
    text.includes('finish_reason')
}
