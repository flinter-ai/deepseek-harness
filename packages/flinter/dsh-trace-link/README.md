# `@flinter/dsh-trace-link`

Status: **SCAFFOLD_ONLY**.

This package reserves the Phase 2 boundary that will consume native DeepSeek
Harness session events and emit FLINTER trace records. It owns no scientific
semantics, Tower authority, persistence, tenant authorization, or runtime
registration yet. Native DSH events remain the L0 source; unknown, missing, and
null values must remain representable when implementation starts.

## Model Experience

### Native event to trace boundary

#### What the model sees

`@flinter/dsh-trace-link` emits no trace records yet and changes no model, prompt, reasoning, or provider behavior.

#### Token effect

No tokens are added, removed, or priced by this scaffold.

#### KV Cache effect

No cache policy is registered by this scaffold.
