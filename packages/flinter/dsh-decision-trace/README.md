---
description: "Bounded, failure-inclusive decision records for opt-in FLINTER DSH producers."
kind: "package-reference"
---

# @deepseek-ai/dsh-decision-trace

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-decision-trace` lets an opt-in producer register an exact DSH tool name and project paired pre-execution and result facts into the durable session log. It records only explicit references, counts, closed statuses, and readiness flags. Tool arguments, prompts, chain-of-thought, result content, provider responses, credentials, media bytes, URLs, and raw error text are excluded.

The package supplies capture and deterministic replay. It does not select actions, change policy, execute a provider, index records, connect a reasoning bank, or establish delivery-gate passage.

## Use this package

Mount the function plugin after `@deepseek-ai/dsh-tools`, then register an adapter from the producer plugin through `ctx.flinterDecisionTrace.register(toolName, adapter)`. Keep the returned disposer in the producer's Cordis effect so hot reload removes the registration.

The adapter owns the mapping from producer data to opaque bounded references. Capture failures append a fixed diagnostic code and never alter the tool result. A selection without a matching result and a result without a matching selection replay as `incomplete`.

## Replay behavior

`foldDecisionEpisodes(events)` validates durable projections, pairs both phases by a session-aware decision identity, removes exact duplicate phases, and rejects changed content or changed call/tool identity under an existing decision ID. It preserves success, rejection, abstention, unavailable evidence, malformed response, provider error, timeout, exhaustion, partial retention, export conflict, replay, restart, cancellation, incomplete, and unknown outcomes.

## Model Experience

### Decision trace capture

#### What the model sees

Nothing from this package enters a model request. `flinter/decision-selection` and `flinter/decision-result` are log-only and do not change the tool schema, prompt, or result content.

#### Token effect

The package makes no model call and adds no model tokens. Its projections are bounded to 32 references per list and 160 characters per reference.

#### KV Cache effect

The package does not change the model-visible prefix, so it has no direct KV-cache effect.

## Known Limitations and Deferred Work

- **Producer adapters are separate** — this package provides the registration and capture mechanism. A segmentation or search producer must supply its own explicit projection.
- **No index or bank writer** — recording and indexing readiness are facts supplied by the producer; this package does not write an evidence index or reasoning bank.
- **No delivery-gate claim** — deterministic fixtures establish package behavior only. Live provider, persistence restart, overhead, reviewer, and delivery receipt evidence remain separate checks.
