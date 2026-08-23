# Agent Note: aws-headless runtime semantic/trace E2E driver

Status: implemented

English | [中文](2026-08-23-dsh-aws-headless-runtime-driver.zh.md)

## Problem

The [aws-runtime-on-S1 integration](2026-08-23-dsh-aws-runtime-on-s1-integration.md)
composed the aws-headless profile but shipped no runnable runtime task: the
cloud worker had no deterministic entrypoint that boots the real assembled
profile and proves the semantic and trace surfaces end to end. Separately, the
trace emitter's signature header (`x-dsh-signature`) did not match the CP
webhook-verify convention, so every trace POST would 401 against the real
route; the reviewed fix on the dsh-segment line (`7ea1e817`, aligning the
header to `x-webhook-signature`) had not been merged forward into the
aws-runtime branch.

## Decision

- **Merge-forward of the reviewed emitter fix.** `integration/aws-runtime-r1-double-prime`
  merges `flinter/dsh-segment@7ea1e817d84a79444d1442883c94a38117c73aed` (the
  `x-webhook-signature` header alignment) while preserving the aws-runtime
  extras; the plugin is not reimplemented or cherry-picked. The stale
  `x-dsh-signature` literals in the trace emitter's declarations, tests,
  READMEs, and this note's predecessor follow in the same change.
- **Runtime driver (`examples/aws-headless/runtime-driver.js`).** A reusable
  driver boots the REAL assembled aws-headless profile through the Loader and
  drives `RUN_BASELINE_PHYSICS` as an interface check only (the honest
  `prototype_stub` abstention is required and reported as such, never as
  scientific success) and `search_events` with a deterministic query against
  the runtime corpus and engine, requiring `status: completed`,
  `abstained: false`, bounded results, the pinned producer engine
  `c05c3fc747f0aa0fcb9d0603009add71c59e091b` in `provenance.engine_pin`, and an
  `accepted` automatic trace emission when `$PES_TRACE_*` is configured. It
  emits exactly one bounded machine-readable JSON summary and exits nonzero
  per failure class (missing corpus 2, engine failure 3, abstention 4,
  malformed provenance 5, trace transport 6, baseline interface check 7; boot 1).
  No LLM/model decision is made anywhere; the summary declares itself
  runtime semantic/trace E2E (`scientific_proof: false`), never TowerH proof.
- **No fixture fallback in production.** The engine seam resolves
  `$PES_QUERY_COMMAND` or the packaged `python3 -m event_index.query` default;
  a test fixture covers failure classification only.
- **Keyless process test (`tests/runtime-driver.e2e.ts`).** The driver runs as
  a subprocess against the real aws-headless Loader with a localhost callback
  receiver and a deterministic engine command (the protocol-compatible stub).
  Assertions cover the one-line summary, the automatic emission end to end
  (exact canonical body, `x-webhook-signature` HMAC-SHA256 header, pinned
  producer SHA, deterministic record id), and every nonzero exit with
  dedicated fixtures (failing engine, abstaining engine, unpinned profile via
  `materializeProfile(..., { enginePin: false })`, 500 receiver).
- **Docs.** The aws-headless README documents the entrypoint invocation and
  the exit-code table for the data-infra runtime; the dsh-pes trace-emitter
  note's header fact is corrected to `x-webhook-signature`.

## Alternatives considered

**Run the driver against a fixture composition (e.g. the dsh-pes smoke's
cordis.yml) in production.** Rejected: the runtime task must boot the real
assembled profile so composition regressions — a missing bundle or an unpinned
engine — fail loud instead of passing a shrunken config; fixtures are
test-only.

**Treat the RUN_BASELINE_PHYSICS stub as scientific success.** Rejected: the
honest `prototype_stub` abstention is the interface contract; the driver
requires and reports it as an interface check and marks the summary
`scientific_proof: false`.

**Make the driver an agent-loop task and let the model decide.** Rejected: the
runtime E2E needs determinism without an LLM key or a model call; a model
decision would make failure classification nondeterministic.

**Verify trace emission by reading the receiver from inside the driver.**
Rejected: transport ownership means the driver never selects or observes its
own destination; the driver requires the emitter's runtime-reported
`accepted` outcome, and the test's receiver proves the wire record.

## Consequences

- The double-prime branch carries the reviewed signature fix (header now
  `x-webhook-signature`, matching the CP webhook-verify convention), and the
  aws-headless line now has a deterministic runtime semantic/trace E2E with a
  documented entrypoint
  (`node --import tsx/esm examples/aws-headless/runtime-driver.js [profile-name]`)
  and an exit-code contract the data-infra G3/G4 runtime can invoke.
- The driver makes no AWS/provider call and no LLM call; `DSH_COMMIT`,
  control-plane code, credentials, and the dsh-pes/dsh-segment tool semantics
  are unchanged.
- Still NOT_RUN: the real CP `/webhooks/dsh-worker/trace` route plus Postgres
  ancestry validation, runtime engine packaging (`python3 -m event_index.query`
  importable at deploy time), and the real TowerH scientific gates — the
  driver is runtime semantic/trace E2E evidence only.
