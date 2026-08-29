# `@flinter/dsh-aws-worker-profile`

Status: **SCAFFOLD_ONLY**.

This reserves a future AWS worker composition. It performs no AWS calls, does
not read or synchronize Secrets Manager, does not write control-plane state,
and is not a deployable or production profile. AWS parity belongs to later
Phase 4 gates.

## Model Experience

### Future AWS worker composition

#### What the model sees

No model or provider is registered by `@flinter/dsh-aws-worker-profile`, and no AWS or runtime call is made.

#### Token effect

No tokens are added, removed, or priced by this scaffold.

#### KV Cache effect

No cache policy is registered by this scaffold.
