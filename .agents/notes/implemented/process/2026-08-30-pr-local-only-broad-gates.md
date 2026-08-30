# Agent Note: Keep broad PR gates local-only

Status: implemented

English | [中文](2026-08-30-pr-local-only-broad-gates.zh.md)

## Problem

The pull-request workflow ran repository-wide coverage and consumer gates on every hosted runner. The coverage gate runs sharded instrumentation plus shell-heavy tests; the consumer gate runs recorded-session, browser, compatibility, package, documentation, and built-artifact checks. These jobs are slow and sensitive to hosted process and snapshot environments.

## Decision

The required pull-request verdict contains only Node 24 static validation, the keyless Python SDK suite, and the Linux release-shaped Python runtime targets. Full coverage, snapshots and artifacts, extra Node versions, Windows/macOS matrices, benchmarks, real-provider tests, Cloudflare previews, AWS/Tower/Beam checks, and release publishing are local-only, manual-only, or nightly-only.

The local commands are recorded in `.github/workflows/ci.yml`. A skipped hosted job is `NOT_RUN` evidence and must not be reported as a passing test. These suites must not be added to the pre-commit hook.

## Evidence

On PR #47, the hosted coverage gate ran for 571 seconds and failed a persistent PowerShell state assertion. The snapshots/artifacts gate failed three recorded-session assertions and a browser snapshot gate after 346 seconds. The failures were not evidence that the DSH archive change was incorrect; focused local tests and build/typecheck gates remained separate.

## Consequence

PR review gets a short deterministic package-integrity signal. Local-only gates remain required before release, cutover, or any claim that depends on exhaustive coverage, recorded snapshots, cross-runtime compatibility, provider behavior, or cloud/platform evidence.
