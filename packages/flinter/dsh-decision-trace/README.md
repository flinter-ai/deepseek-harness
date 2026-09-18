---
description: "Bounded, failure-inclusive decision records for opt-in FLINTER DSH producers."
kind: "package-reference"
---

# @deepseek-ai/dsh-decision-trace

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-decision-trace` lets an opt-in producer register an exact DSH tool name and project paired pre-execution and result facts into the durable session log. It records only explicit references, counts, closed statuses, and readiness flags. Tool arguments, prompts, chain-of-thought, result content, provider responses, credentials, media bytes, URLs, and raw error text are excluded.

The package supplies capture and deterministic replay. It does not select actions, change policy, execute a provider, index records, connect a reasoning bank, or establish delivery-gate passage.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the function plugin after `@deepseek-ai/dsh-tools`, then register an adapter from the producer plugin through `ctx.flinterDecisionTrace.register(toolName, adapter)`. Keep the returned disposer in the producer's Cordis effect so hot reload removes the registration.

### When to choose it

Choose this package when a FLINTER producer needs durable, failure-inclusive decision facts for tools it owns without leaking prompts, arguments, content, or error text into the session log. Avoid it when capture must change a tool result — the observers are log-only and never alter an outcome — and when no producer adapter exists, because the package records nothing until a producer registers an exact tool name.

### Setting it up

Mount the plugin with no configuration:

```yaml
- name: '@deepseek-ai/dsh-decision-trace'
```

The adapter owns the mapping from producer data to opaque bounded references. A capture failure appends one fixed diagnostic code to `ctx.flinterDecisionTrace.diagnostics` — `selection:projection-failed` or `result:projection-failed` — and never alters the tool result. A selection without a matching result and a result without a matching selection replay as `incomplete`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Replay behavior

`foldDecisionEpisodes(events)` validates durable projections, pairs both phases by a session-aware decision identity, removes exact duplicate phases, and rejects changed content or changed call/tool identity under an existing decision ID. It preserves success, rejection, abstention, unavailable evidence, malformed response, provider error, timeout, exhaustion, partial retention, export conflict, replay, restart, cancellation, incomplete, and unknown outcomes.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Capture service, bounded validators, `tools/pre-execute` and `tools/result` observers, and `foldDecisionEpisodes`. |
| [`src/types.ts`](src/types.ts) | Decision identity, status, disposition, projection, event, episode, and adapter contracts. |
| [`src/invariant.ts`](src/invariant.ts) | Package-owned invariant companion for the DSH test host. |
| [`tests/decision-trace.spec.ts`](tests/decision-trace.spec.ts) | Bounded-capture, failure, replay, and HMR-safety tests. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [DSH tools](../../core/tools/README.md) — the tool-dispatch events the capture observers hook.
- [DSH session](../../core/session/README.md) — the durable session log that stores the decision events.
- [Extensions subsystem](../../../docs/subsystems/extensions.md) — the generated `ctx.flinterDecisionTrace` service API.
- [FLINTER group map](../README.md) — the sibling FLINTER packages and the group's DSH boundary.

-----

<a id="model-experience"></a>
## Model Experience

### Decision trace capture

#### What the model sees

Nothing from this package enters a model request. `flinter/decision-selection` and `flinter/decision-result` are log-only and do not change the tool schema, prompt, or result content.

#### Token effect

The package makes no model call and adds no model tokens. Its projections are bounded to 32 references per list and 160 characters per reference.

#### KV Cache effect

The package does not change the model-visible prefix, so it has no direct KV-cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Producer adapters are separate** — this package provides the registration and capture mechanism. A segmentation or search producer must supply its own explicit projection.
- **No index or bank writer** — recording and indexing readiness are facts supplied by the producer; this package does not write an evidence index or reasoning bank.
- **No delivery-gate claim** — deterministic fixtures establish package behavior only. Live provider, persistence restart, overhead, reviewer, and delivery receipt evidence remain separate checks.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
