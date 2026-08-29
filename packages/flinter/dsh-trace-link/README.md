# `@flinter/dsh-trace-link`

Status: **P2_LOCAL_IMPLEMENTATION**.

This package checkpoints native DeepSeek Harness `SessionEvent` records into
deterministic, immutable local segment descriptors and manifests. The
`LocalTraceCheckpointSink` is the Phase 2 `DSH-ALPHA-TRACE-01` gate: it proves
ordered ranges, stable hashes, idempotent retries, identity boundaries, and
credential redaction without changing the DSH Session codec.

Native DSH events remain the L0 source. Unknown, missing, null, provenance,
and abstention values are preserved as data. The package owns no scientific
semantics, Tower authority, tenant authorization, or runtime registration.
B2/RDS storage is the separate Phase 4 `TES-484` adapter.

The in-memory store is test infrastructure only. It makes no provider, AWS,
B2, RDS, PikPak, investigation, observation, or TowerN calls.

## Model Experience

### Native event to trace boundary

#### What the model sees

`@flinter/dsh-trace-link` observes already-produced native session events. It does not change model, prompt, reasoning, provider, or session behavior.

#### Token effect

No tokens are added, removed, or priced by this checkpoint boundary.

#### KV Cache effect

No cache policy is registered by this checkpoint boundary.
