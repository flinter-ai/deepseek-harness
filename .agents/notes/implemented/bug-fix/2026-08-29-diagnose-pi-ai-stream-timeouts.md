# Agent Note: Diagnose pi-ai stream timeout phase

Status: implemented

English | [中文](2026-08-29-diagnose-pi-ai-stream-timeouts.zh.md)

## Problem

The pi-ai adapter reported every idle timeout with the same message even though a provider can stall before producing any translated event or after a partial response. The durable retry layer then had no diagnostic distinction when investigating a failed request.

## Decision

The pi-ai adapter counts translated stream events for each request. A `TIMEOUT` failure now records the provider route, model, and whether the idle period occurred before the first translated event or after a counted partial response. The adapter still aborts the provider stream through the existing watchdog and still emits the same stable `TIMEOUT` failure code.

The live ARK profile removes `TIMEOUT` from its normal retryable codes. A provider request that may have been accepted is therefore not automatically replayed after a five-minute idle period; rate-limit, server, transport, and empty-response recovery remain unchanged.

## Alternatives considered

**Increase the idle timeout.** Rejected: it would make an unproductive request occupy the agent longer and would not distinguish a provider stall from a slow but active response.

**Retry every timeout.** Rejected for the ARK route: an idle timeout does not prove that the provider rejected the request, so blind replay can duplicate work and billing. The existing per-provider retry-code list keeps this decision route-specific.

**Change the global retry policy.** Rejected: other providers and direct transport deployments may have safe timeout-retry semantics, so their behavior must remain configurable.

## Consequences

The next timeout log identifies the request phase without exposing credentials or prompt content. An ARK timeout now requires a user-initiated retry or another downstream recovery action. The adapter does not add a provider health check or automatic failover; those require an explicit routing policy and could change model-visible behavior.
