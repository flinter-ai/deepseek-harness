# Agent Note: DSH attempt runtime safety

Status: implemented

English | [中文](2026-08-29-dsh-attempt-runtime-safety.zh.md)

## Problem

The alpha worker adapter supplies durable DSH session identity and create/resume semantics, but a replacement worker still needs launch transport, filesystem isolation, manifest, fencing, and canary rules. Reusing the old Orca worker home would either lose native DSH session continuity or leave mutable attempt state shared across retries.

## Decision

The FLINTER alpha profile exposes a non-Orca safety layer beside the worker adapter. `buildDshAttemptLaunch()` passes the task as a literal argument to a direct child process and constructs a scrubbed environment. `resolveWorkerAttemptRoots()` and `createWorkerAttemptRoots()` retain the control-plane `DSH_SESSION_ROOT` while creating fresh owner-only attempt and artifact roots, and `writeWorkerAttemptManifest()` records one secret-free launch record with exclusive creation. `cleanupWorkerAttempt()` removes only those ephemeral roots after a terminal executor proof and does not follow symlinks. `assertCurrentWorkerCallback()` applies the current lease and attempt identity as a logical fence, while `fenceWorkerAttempt()` requires an injected executor to report a terminal state after stop is requested. `assertWorkerCanaryProof()` requires startup, literal task receipt, session persistence, accepted callback, and recorded completion before fan-out; artifact production is conditional.

The layer deliberately does not authenticate callbacks, place or stop AWS/Beam tasks, or classify provider stderr. Those are control-plane/executor and DSH ownership boundaries respectively. A worker replacement may begin only after the executor fence resolves and the new launch carries the same DSH session identity with advanced lease and attempt fields.

## Alternatives considered

**Create a new DSH home for each retry.** This preserves physical separation but breaks the alpha adapter's same-session resume contract. The implementation instead isolates ephemeral attempt roots around one durable DSH session root.

**Keep shell interpolation behind a fixed script.** The task would remain exposed to shell parsing and quoting regressions. The implementation uses direct argv transport and tests shell metacharacters and substitutions as literal data.

**Let the launcher infer retries from stderr strings.** Provider failures belong to DSH model/API recovery and worker failures belong to the control plane. String classification in this library would blur those owners and make replacement policy unauthoritative.

**Treat a coordinator timeout as a process fence.** A timeout does not prove that the executor stopped the old computation. Replacement is therefore gated on an injected terminal-state observation.

## Consequences

Native DSH JSONL persistence remains continuous across replacement attempts, while scratch, artifacts, and launch metadata are physically separated and cannot be reused by the same attempt identity. The manifest provides an audit record without callback URLs or secret references. Logical stale-callback rejection and physical executor fencing are independently testable, but cloud proof and authenticated callback evidence remain `NOT_RUN` until the control-plane integration exists.

The canary contract is stronger than process exit success and intentionally blocks fan-out when any required observation is absent. This package does not itself start an executor, send a callback, or advance authoritative control-plane state.
