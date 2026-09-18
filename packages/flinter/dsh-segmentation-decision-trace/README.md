---
description: "Producer adapter projecting normalized segmentation decision records into bounded FLINTER decision traces."
kind: "package-reference"
---

# @deepseek-ai/dsh-segmentation-decision-trace

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-segmentation-decision-trace` mounts one `DecisionTraceAdapter` on `ctx.flinterDecisionTrace` under the exact name of an existing segmentation tool. The producer owns the normalized request/result records; this package validates them fail-closed against a bounded allowlist and projects them into the `SelectionProjection`/`ResultProjection` capture contract. It never registers a tool, changes tool behavior or policy, adds model-visible content, calls a provider, indexes data, or writes a reasoning bank.

This package is a source/fixture adapter only. No live TowerH or segmentation producer, provider execution, restart/replay run, 10,000-episode run, overhead measurement, independent verifier, or Gate 1 receipt/PASS is claimed.

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

Mount the function plugin after `@deepseek-ai/dsh-decision-trace`. Its config carries `source` resolver functions, so it is not YAML-expressible; producers mount it programmatically with the exact tool name and their normalized resolvers.

### When to choose it

Choose this package when a segmentation producer can state its decision facts as opaque bounded references and closed statuses, and wants them captured without leaking raw arguments, prompts, provider payloads, or error text into the session log. Avoid it when the tool does not exist yet — the adapter claims only an existing exact tool name — or when the producer cannot normalize its facts, because invalid records fail closed instead of being captured partially.

### Setting it up

```ts
import { Context } from '@deepseek-ai/cordis'
import * as segmentationTrace from '@deepseek-ai/dsh-segmentation-decision-trace'
import type { SegmentationDecisionSource } from '@deepseek-ai/dsh-segmentation-decision-trace'

declare const source: SegmentationDecisionSource

async function mount(ctx: Context): Promise<void> {
  await ctx.plugin(segmentationTrace, {
    toolName: 'segment.select',
    source,
  })
}
```

The `SegmentationDecisionSource` resolvers return the producer-owned `SegmentationDecisionRequest` and `SegmentationDecisionResult` records for each execution. Required request facts are a non-empty `allowedActions`, a `chosenAction` inside it, and `sourceRef`/`modelRef`/`policyRevisionRef`. Required result facts are an explicit `outcome` and `disposition` — including `'unknown'` — so a missing fact cannot hide behind a default.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Fail-closed allowlist

`createSegmentationDecisionAdapter(source)` wraps the producer resolvers and validates every record they return before projecting it. Only allowlisted fields are read; unknown record fields are never copied, so producer-local or sensitive values cannot escape. Missing or malformed required facts throw, and the capture service records one fixed diagnostic code — `selection:projection-failed` or `result:projection-failed` — without changing the tool outcome.

### Bounded references and defaults

Every reference is a bounded string of at most 160 characters from `[A-Za-z0-9_.:/-]` after an alphanumeric head — URLs, spaces, and free text do not parse — and each list carries at most 32 unique references. `budgetBefore` and `usage` accept a non-negative safe integer or `null` for unmeasured cost. Omitted facts default to empty reference lists, `null` measurements, `'unknown'` lineage, and `false` recording/index readiness; they are never inferred from the tool outcome. All fifteen `DecisionStatus` outcomes — success, rejection, abstention, unavailable evidence, malformed response, provider error, timeout, exhaustion, partial retention, export conflict, replay, restart, cancellation, incomplete, and unknown — and all six dispositions pass through unchanged.

### Lifecycle and disposal

`apply` registers the adapter through `ctx.effect`, so the plugin fiber owns the registration disposer: fiber disposal or hot reload removes exactly this registration, and the disposer deletes the name only while it still owns it. A duplicate tool name fails the mount with the capture service's duplicate-registration error and leaks neither a registration nor an effect. The package keeps the exact tool name and registers no tool itself.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Fail-closed projection validators, `createSegmentationDecisionAdapter`, plugin config, and `apply`. |
| [`src/types.ts`](src/types.ts) | Producer-owned normalized request, result, and source contracts. |
| [`src/invariant.ts`](src/invariant.ts) | Package-owned invariant companion for the DSH test host. |
| [`tests/segmentation-decision-trace.spec.ts`](tests/segmentation-decision-trace.spec.ts) | Bounded-projection, failure-containment, duplicate-registration, and HMR-safety tests. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [DSH decision trace](../dsh-decision-trace/README.md) — the capture service, projection contract, diagnostics, and replay fold this adapter registers into.
- [DSH tools](../../core/tools/README.md) — the tool-dispatch events the capture observers hook.
- [DSH session](../../core/session/README.md) — the durable session log that stores the decision events.
- [Extensions subsystem](../../../docs/subsystems/extensions.md) — the generated `ctx.flinterDecisionTrace` service API.
- [FLINTER group map](../README.md) — the sibling FLINTER packages and the group's DSH boundary.

-----

<a id="model-experience"></a>
## Model Experience

### Segmentation decision capture

#### What the model sees

Nothing from this package enters a model request. The adapter emits log-only `flinter/decision-selection` and `flinter/decision-result` events through the capture service and does not change the tool schema, prompt, or result content.

#### Token effect

The package makes no model call and adds no model tokens. Its projections are bounded to 32 references per list and 160 characters per reference.

#### KV Cache effect

The package does not change the model-visible prefix, so it has no direct KV-cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Fixture-scoped evidence** — deterministic fixtures prove package behavior only. No live TowerH or segmentation producer, provider execution, persistence restart/replay, 10,000-episode run, overhead measurement, independent verifier, or Gate 1 receipt/PASS is claimed; each remains a separate check.
- **Producer-owned facts** — the package validates and projects the normalized records the producer supplies; it does not derive segmentation facts from raw executions, so an absent producer resolver means absent capture.
- **No index or bank writer** — recording and indexing readiness are facts supplied by the producer; this package does not write an evidence index or reasoning bank.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
