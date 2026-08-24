# Agent Note: H0 agentic-control activated in the shipped aws-headless profile

Status: implemented

English | [中文](2026-08-24-dsh-h0-production-activation.zh.md)

## Problem

The aws-headless profile shipped without activating the merged H0
agentic-control packages: only the P0.6 trajectory test injected their rows
and profile-local links, so the production-composition gap was invisible to
the composition, boot, and snapshot gates that assert what the shipped profile
activates.

## Decision

`examples/aws-headless/profile/cordis.patch.yml` mounts the two agentic-control
rows (`@deepseek-ai/dsh-agentic-control`, `@deepseek-ai/dsh-tool-agentic-control`)
as plain out-of-tree rows, installed through the same profile-package path as
the Secrets Manager row; the H0 kernel is unchanged. The trajectory test
consumes the shipped rows instead of injecting duplicates, and the composition
gate asserts each row exactly once while the boot gate asserts
`run_physical_assessment`, `finish_investigation`, and `stop_unknown` beside
`RUN_BASELINE_PHYSICS` and the dsh-pes tools. The keyless snapshot records the
assembled model-visible tool surface.

Authority is unchanged: the control plane owns work lifetime, DSH owns the
investigation trajectory, and no queue/lease/Fargate retry authority enters the
composition. `RUN_BASELINE_PHYSICS` remains the honest prototype-stub interface
check, and no external `DSH_COMMIT` moves.

## Alternatives considered

**Declare the H0 packages as profile bundles.** Rejected: activation is a
profile-composition concern, and adding `dsh.bundle` manifests inside the H0
packages would put deployment shape into the kernel packages.

**Keep injecting the rows and links from the trajectory test.** Rejected: the
trajectory gate would keep proving a test-only composition that the shipped
profile does not reproduce.

## Consequences

- The shipped aws-headless profile activates the investigation seam, and the
  keyless composition, boot, and snapshot gates prove it from the materialized
  profile.
- The trajectory gate keeps one test-owned package outside the shipped
  closure: the llm-replay adapter that scripts its model waterfall.