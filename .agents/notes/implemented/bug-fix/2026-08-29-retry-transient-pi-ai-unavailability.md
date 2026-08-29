# Agent Note: Retry transient pi-ai availability failures

Status: implemented

English | [中文](2026-08-29-retry-transient-pi-ai-unavailability.zh.md)

## Problem

Some pi-ai providers discard the HTTP status from a transient outage and emit
only text such as `The model service is temporarily unavailable. Please try
again later.` The adapter classified that text as `PI_AI_ERROR`, which is not in
the default bounded retry set, so a recoverable provider outage ended the agent
step immediately.

## Decision

The pi-ai stream classifier maps explicit transient availability wording —
temporary or current unavailability, service unavailability, an overloaded or
busy backend/server, and `try again later` — to the existing `SERVER` code.
Authentication, quota, rate-limit, invalid-request, timeout, context-overflow,
and transport patterns retain their earlier precedence. No pi-ai SDK retry is
added; the existing `dsh-llm-retry` policy remains the sole durable retry owner.

## Alternatives considered

**Retry every `PI_AI_ERROR`.** Rejected: the generic code also covers unknown
provider failures that may be permanent or indicate a malformed request.

**Add a provider-specific always-retry policy.** Rejected: unbounded retries
could loop on a persistent outage and would make the deployment configuration
responsible for recognizing a common provider error vocabulary.

**Depend on the provider preserving HTTP status.** Rejected: the observed pi-ai
error event did not preserve one, and the adapter cannot recover it after pi-ai
flattens the error.

## Consequences

Known transient availability failures now enter the normal bounded retry path
(two retries by default with exponential backoff and jitter). Unknown failures
remain visible as `PI_AI_ERROR` without being retried automatically. Direct
`ctx.llm.stream()` remains one provider attempt; durable agent-step recovery
continues to own retries.

## Testing

pi-ai conversion tests cover the observed Modelflare wording and an overloaded
backend variant. The existing retry-policy tests continue to establish that
`SERVER` is retryable under the default policy.
