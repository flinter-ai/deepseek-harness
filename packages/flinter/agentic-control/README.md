# `@flinter/agentic-control`

Status: **SCAFFOLD_ONLY**.

This reserves the Phase 2 adapter boundary for existing FLINTER control-plane
contracts. It does not implement or duplicate PR #48’s T0–T4 roadmap, register
workers, claim tasks, write control-plane state, or reopen completed work.

## Model Experience

### Control-plane adapter boundary

#### What the model sees

No model-visible content is registered by `@flinter/agentic-control` in this scaffold.

#### Token effect

No tokens are added, removed, or priced by this scaffold.

#### KV Cache effect

No cache policy is registered; future control-plane context must be measured by the composed consumer.
