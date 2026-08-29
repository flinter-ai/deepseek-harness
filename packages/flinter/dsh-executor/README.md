# `@flinter/dsh-executor`

Status: **CONTRACT_ONLY**.

This package extracts the safety invariants from the old #37/#38/v3 worker
line into a new non-Orca boundary. It validates literal JSON task envelopes,
derives fresh per-attempt workspace/evidence roots, binds an immutable
secret-free manifest, compares logical fence tokens, checks replacement
attempt monotonicity, and gates fan-out on a complete canary proof.

It does not submit tasks, launch processes, create directories, call AWS,
call Orca, or replace Agent Teams. A future Runta/control-plane adapter owns
those side effects and must satisfy this contract before it is loaded into a
runtime profile.

The control plane remains authoritative for lease issuance, physical worker
fencing, callback authentication, image validation, and durable state. DSH
remains authoritative for the live session and its exact persistence root.

## Model Experience

### Executor delivery boundary

#### What the model sees

No task is submitted by `@flinter/dsh-executor`, and no model, prompt,
reasoning, or provider behavior is changed by this contract-only package.

#### Token effect

No tokens are added, removed, or priced by this package.

#### KV Cache effect

No cache policy is registered by this package.
