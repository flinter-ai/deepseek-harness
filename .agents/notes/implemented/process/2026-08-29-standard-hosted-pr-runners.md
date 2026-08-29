# Agent Note: Standard hosted runners for all DSH CI

Status: implemented

English | [中文](2026-08-29-standard-hosted-pr-runners.zh.md)

## Problem

DSH workflows selected organization-specific and self-hosted runner labels that were not guaranteed to exist in the repository's current Actions capacity. Jobs could remain queued without a runner, including master-only diagnostics and manual benchmark jobs.

## Decision

All DSH workflow runner selectors use standard GitHub-hosted labels. Pull-request Linux work and the Cloudflare preview use `ubuntu-latest`; pull-request Windows work uses `windows-latest`; the master serial references and manual measurements use those same standard labels. The manual measurements now report standard-hosted capacity rather than depending on named larger-runner pools. Workflow tests reject `self-hosted`, `dsh-*`, `vm-backup`, `dsh-win-ci`, and the old failover variables.

## Verification

The workflow set no longer selects `dsh-ubuntu-*`, `dsh-windows-*`, `vm-backup`, `dsh-win-ci`, or `self-hosted`. The current queued run is not modified or retried by this change; a new run is required to observe the standard-hosted path.

## Alternatives considered

**Keep the custom pools with a repository-variable failover.** This still leaves the normal path dependent on unavailable labels and makes a repository setting determine whether a required check can start.

**Keep named pools for optional benchmarks.** Rejected because a manual workflow still needs to be runnable from the repository without organization-specific registration. The benchmarks now measure the standard-hosted baseline; any future external capacity experiment belongs outside this repository's CI gate.

## Consequences

Standard-hosted DSH workflows can start without organization-specific runner registration. They may take longer than the former larger pools, so their concurrency and benchmark timeout are bounded accordingly.
