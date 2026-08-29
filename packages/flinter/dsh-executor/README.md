# `@flinter/dsh-executor`

Status: **SCAFFOLD_ONLY**.

This reserves the executor/Runta adapter boundary for Phase 2. The eventual
implementation must prove literal delivery, attempt identity, retry lineage,
fencing, startup watchdogs, canaries, and worktree/evidence isolation. Agent
Teams remains coordination only until this parity exists. No task is submitted
and no sandbox or worktree is created by this scaffold.

## Model Experience

### Executor delivery boundary

#### What the model sees

No task is submitted by `@flinter/dsh-executor`, and no model, prompt, reasoning, or provider behavior is changed by this scaffold.

#### Token effect

No tokens are added, removed, or priced by this scaffold.

#### KV Cache effect

No cache policy is registered by this scaffold.
