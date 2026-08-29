# Agent Note: Declare Modelflare's combined context capacity

Status: implemented

English | [中文](2026-08-29-declare-modelflare-context-capacity.zh.md)

## Problem

The hand-declared Modelflare `gpt-5.6-sol` route did not publish its combined
request and response context capacity. `llm-pi-ai` therefore used its generic
262,144-token fallback, causing long resumed sessions to be rejected locally
before the provider could use the model's larger context.

## Decision

The Modelflare model declaration in the AWS headless profile, Orca worker-home
generator, and local deployment settings now sets `contextWindow: 1000000` and
declares `reasoningEfforts.high: high`. The AWS worker entrypoint emits the same
fields. The value is the provider/model capacity confirmed for this deployment.
The route keeps `maxTokens` unset; total context capacity and per-request output
budget are separate settings, so the provider retains control of its output
default.

## Alternatives considered

**Keep the generic 262,144-token fallback.** Rejected: it under-reports the
confirmed model capacity and makes the harness reject valid long requests.

**Set `maxTokens` to 1,000,000 as well.** Rejected: `maxTokens` controls output
generation, not total context, and no provider output limit was established by
this change.

**Leave the model capacity unset and rely on provider metadata.** Rejected:
the endpoint did not provide a usable capacity value, while the deployment's
verified model information does.

## Consequences

Modelflare requests can use the declared one-million-token total context
capacity, and the UI/runtime exposes `high` reasoning for the model. Automatic
compaction behavior is unchanged; it now receives the correct route capacity
when deciding whether context pressure requires compaction.

## Testing

Focused AWS profile and worker-entrypoint tests assert the generated fields.
The local headless smoke remains the live credential-path check; it does not
prove the provider's advertised capacity.
