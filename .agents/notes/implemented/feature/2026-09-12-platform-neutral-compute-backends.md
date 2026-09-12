# Agent Note: Platform-neutral bounded compute backends

Status: implemented

English | [中文](2026-09-12-platform-neutral-compute-backends.zh.md)

## Problem

The DSH harness has to run the same worker contract on a bounded sandbox, the
existing EC2 host, or a local development process. Encoding the substrate in
the runner or treating a new sandbox as an unbounded process launch would make
the web and EC2 paths diverge and could create an accidental compute burst.

## Decision

`dsh-alpha-profile` owns a platform-neutral compute contract with explicit
`codesandbox`, `ec2`, and `local` backends. New launches default to
`codesandbox`; the EC2 systemd overlay selects `ec2`, and local launch can
select another backend through `DSH_COMPUTE_BACKEND`. Unknown values fail
closed rather than silently falling back.

The profile exposes one process-local admission guard with a default of one
active attempt, one active attempt per backend, a 30-minute wall bound, a
five-minute idle bound, and a five-minute sandbox hibernation timeout. It
enforces one active attempt per session, total and per-backend capacity, and
lease-current checks. It is an adapter guard, not a replacement for the
control-plane's durable admission and fencing. The earlier
[bounded background-job admission decision](../../bug-fix/2026-08-11-bounded-background-job-admission.md)
continues to own Task-backed background jobs.

The CodeSandbox adapter accepts an injected narrow runtime interface instead
of making the profile depend on a vendor SDK. It starts one literal argv in a
bounded VM, disposes the VM after completion or stop, and rejects credential-
shaped environment names. Secret references may be passed as non-secret
names; secret values remain owned by the selected host/runtime. Attempt
manifests and launch environments record the selected backend so a later
worker cannot be mistaken for a different substrate. This extends the
[reproducible EC2 deployment decision](../../process/2026-09-07-dsh-ec2-deployment.md)
without changing its exact-SHA or fail-closed deployment rules.

The contract does not claim a live CodeSandbox provider integration: the host
must inject the runtime implementation and the control plane must provide
durable cross-process admission, fencing, storage, and cost/account policy.

## Alternatives considered

**Make CodeSandbox the only worker implementation.** Rejected because EC2 is
already an operational substrate and local execution remains necessary for
development and deterministic tests.

**Let each launcher invent its own environment and admission rules.** Rejected
because web, EC2, and local runs would then record different identities and
could bypass the same-session and capacity guarantees.

**Import a CodeSandbox SDK into the profile package.** Rejected because the
optional vendor SDK and its credentials belong to the host deployment; an
injected narrow interface keeps the core profile portable and keyless.

**Use process-local admission as the distributed lock.** Rejected because it
cannot coordinate multiple web/EC2 processes. Durable control-plane admission
and fencing remain required before production multi-host use.

## Consequences

The web path has a bounded default substrate and EC2 can be selected by
configuration without maintaining a second worker implementation. Every
attempt carries the backend identity, making backend changes observable and
replayable. The conservative default may reject concurrent work until an
operator explicitly raises capacity, and the CodeSandbox adapter remains a
host integration seam until its runtime and storage contracts are implemented.

## Testing

The compute, attempt, worker, and local-harness suites pass with 31 focused
tests. They cover backend parsing, default and explicit limits, duplicate and
same-session admission, total/per-backend capacity, lease release, backend
stamping, adapter selection, literal argv, VM disposal, hibernation settings,
and credential-shaped environment rejection. The tests inject a fake
CodeSandbox runtime and do not contact a provider.
