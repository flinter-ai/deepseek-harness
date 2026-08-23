# Agent Note: dsh-segment + dsh-pes integrated into the AWS runtime line

Status: implemented

English | [中文](2026-08-23-dsh-aws-runtime-on-s1-integration.zh.md)

## Problem

The AWS runtime composition (`llm-pi-ai` Bedrock, AWS Secrets Manager
credentials, agentic-control, and the dsh-orca worker bridge) includes the
segment and searchable-trace surfaces from these immutable inputs:
dsh-segment S0+S1 at
`5c67922215d18daa362f8bdf78b120f623c3f385`, the searchable-trace plugin at
`9ab7deb7bce7df0c0970e29686a3f76ddf62b027`, and the engine producer at
`c05c3fc747f0aa0fcb9d0603009add71c59e091b`
(`feat/searchable-trace-engine` in the flinter research repo).

## Decision

The composition integrates ONLY the three immutable inputs, without
recreating the engine or the segment runtime:

- The aws-headless profile (`examples/aws-headless`) lists both bundles in
  `dsh.profile.bundles`
  (base, dsh-orca, dsh-segment, dsh-pes) and its patch pins the plugin row's
  `config.engine_pin` to the engine producer SHA — the pin seam flows into
  every tool result's `provenance.engine_pin`. The profile materialization
  links the two `@flinter` packages the same way it links dsh-orca, and the
  composition, boot, and snapshot gates assert the new rows and tool
  registrations beside the untouched Bedrock/Secrets-Manager/agentic-control
  rows.

The engine itself remains unimported: the plugin spawns it through the
configured command seam at call time, and runtime engine packaging stays
integration-gate work. `DSH_COMMIT`, control-plane code, credentials, and the
existing AWS composition are unchanged; no AWS/provider/cloud resource was
touched; the old 20ec9d16 worker was not relaunched.

## Alternatives considered

**Promote the current worker pin as the semantic runtime.** Rejected: the
20ec9d16 worker proves infrastructure lifecycle only and does not prove the S1
semantic capability.

**Import the searchable-trace engine into the DSH bundle.** Rejected: the
plugin's explicit subprocess seam keeps the Python producer separate from the
DSH package and preserves the immutable producer pin for deployment packaging.

**Replace the existing AWS composition while adding the two bundles.** Rejected:
the integration must preserve Bedrock, Secrets Manager, agentic-control, and
dsh-orca behavior; the profile only adds the segment and searchable-trace rows.

## Consequences

- The AWS runtime composition boots with exactly one dsh-segment row
  (`RUN_BASELINE_PHYSICS`) and exactly one dsh-pes row (four tools,
  `engine_pin` pinned) — keyless boot makes zero AWS calls, asserted by the
  extended composition and boot gates.
- The R1 semantic milestone (real TowerH scans, real outcome labels, RDS
  `005_experience_events`, Octen embeddings) and every cloud semantic gate
  remain **NOT_RUN**; anything that claims otherwise is wrong.
