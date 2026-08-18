# dsh-agentic-control

English | [中文](README.zh.md)

Event-sourced investigation-control capability for the DeepSeek Harness: one typed `InvestigationState` per session, committed exclusively through full-snapshot `investigation/change` session events.

The state tracks a candidate (`id`, `actionFamily`, `window`), evidence requirements with a derived status, four independently assessed physical dimensions (hand-observation validity, trace quality, HOI support, object trace quality), a provider-authored lineage verdict, an attempt log with provenance, and an attempt budget.

## Authority

Investigations are started by the harness through the privileged `ctx.investigations.start` channel, never by the model. Lineage moves only through a registered `PhysicalAssessmentProvider`'s typed result; no tool argument or model output can attach or reject it. Every assessment attempt — failed or not — consumes one budget slot.

## Providers

`runPhysicalAssessment` resolves the configured provider lazily at the first assessment, so provider plugins may load after this service. P0 ships the built-in `stub` provider, which resolves every dimension and attaches lineage. Real Tower adapters register through `ctx.investigations.registerProvider(provider)`, which returns a disposer.

## Config

| Field | Default | Meaning |
|---|---|---|
| `maxAttempts` | `3` | Default attempt cap for investigations that omit their own. |
| `provider` | `stub` | Id of the registered physical-assessment provider. |

## Replay

`decodeInvestigationChange` validates one durable change fail-loud; `foldInvestigations` replays a session log to the current state. The fold enforces one investigation per session, single-step revisions, attempts appended only by assess operations, and no mutation after a terminal phase. The package invariant companion (`/invariant`) applies the same checks to loaded and live logs.

## Model Experience

Indirectly, through `dsh-tool-agentic-control`: the service owns state and authority; the tool package owns every model-visible surface.

#### KV Cache effect

No direct invalidation; the service never writes a request prefix.

## Known Limitations and Deferred Work

- **Stub provider only** — no real Tower adapter exists yet; `stub` resolves all dimensions unconditionally.
- **One investigation per session** — a second start is rejected; multi-candidate sessions are deferred.
- **Derived evidence status is a heuristic** — coverage is computed from the four physical dimensions alone, not from per-requirement verification.
