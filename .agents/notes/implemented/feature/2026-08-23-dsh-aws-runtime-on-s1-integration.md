# Agent Note: dsh-segment + dsh-pes integrated into the AWS runtime line

Status: implemented

English | [中文](2026-08-23-dsh-aws-runtime-on-s1-integration.zh.md)

## Problem

The AWS runtime line (`flinter/aws-runtime`: Bedrock via `llm-pi-ai`, AWS
Secrets Manager credentials, agentic-control, the dsh-orca worker bridge)
had no segment or searchable-trace surface. Both plugins existed only as
standalone immutable inputs: dsh-segment S0+S1 at
`5c67922215d18daa362f8bdf78b120f623c3f385`, the searchable-trace plugin at
`9ab7deb7bce7df0c0970e29686a3f76ddf62b027`, and the engine producer at
`c05c3fc747f0aa0fcb9d0603009add71c59e091b`
(`feat/searchable-trace-engine` in the flinter research repo). The producer
SHA was recorded as provenance documentation but no composition pinned it.

## Decision

Create branch `integration/aws-runtime-on-s1` from `flinter/aws-runtime`
(`24215f21c1`) and integrate ONLY the three immutable inputs, without
recreating the engine or the segment runtime:

- Merge commit 1 (`8987c4981a`): dsh-segment S0+S1 at `5c67922215`.
- Merge commit 2 (`70aaf1f6ab`): searchable-trace plugin at `9ab7deb7bc`.
- Composition wiring: the aws-headless profile (`examples/aws-headless`) now
  lists **both** bundles in `dsh.profile.bundles`
  (base, dsh-orca, dsh-segment, dsh-pes) and its patch pins the plugin row's
  `config.engine_pin` to the engine producer SHA — the pin seam flows into
  every tool result's `provenance.engine_pin` (covered by the plugin's seam
  spec). The profile materialization links the two `@flinter` packages the
  same way it links dsh-orca, and the composition/boot gates assert the new
  rows and tool registrations beside the untouched Bedrock/Secrets-Manager/
  agentic-control rows.

The engine itself remains unimported: the plugin spawns it through the
configured command seam at call time, and runtime engine packaging stays
integration-gate work. `DSH_COMMIT`, control-plane code, credentials, and the
existing AWS composition are unchanged; no AWS/provider/cloud resource was
touched; the old 20ec9d16 worker was not relaunched.

The commit was produced through a workspace-local git store
(`/private/tmp/flinter-aws-r1-git`) because the worktree's git-dir
(`/Users/oldap/finter/deepseek-harness/.git/…`) rejects all writes in this
session and no escalation channel exists; the commit set is identical to what
the worktree would produce (same parents, same trees).

## Consequences

- The AWS runtime composition boots with exactly one dsh-segment row
  (`RUN_BASELINE_PHYSICS`) and exactly one dsh-pes row (four tools,
  `engine_pin` pinned) — keyless boot makes zero AWS calls, asserted by the
  extended composition and boot gates.
- The R1 semantic milestone (real TowerH scans, real outcome labels, RDS
  `005_experience_events`, Octen embeddings) and every cloud semantic gate
  remain **NOT_RUN**; anything that claims otherwise is wrong.
- Re-run `git push` with a writable git-dir to publish
  `integration/aws-runtime-on-s1`; the working tree at
  `/private/tmp/flinter-aws-r1` is already the exact merged content.