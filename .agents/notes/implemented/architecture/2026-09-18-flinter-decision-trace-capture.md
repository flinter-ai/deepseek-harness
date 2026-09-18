# Agent Note: FLINTER DSH decision trace capture

Status: implemented

English | [中文](2026-09-18-flinter-decision-trace-capture.zh.md)

## Problem

FLINTER needs failure-inclusive decision evidence from current DSH sessions before it can measure whether traces improve diagnosis or later construct a reviewed reasoning bank. Producer-specific payloads may contain prompts, media, credentials, provider text, or unstable implementation fields, and a tracing failure must not change the tool decision being observed.

## Decision

`@deepseek-ai/dsh-decision-trace` is an opt-in function plugin on the existing ToolRuntime extension points. A producer registers an exact tool name and two synchronous projectors. The plugin validates their bounded allowlist outputs and appends one log-only `flinter/decision-selection` event before execution and one `flinter/decision-result` event after final settlement. Projector, validation, and append failures become fixed bounded diagnostic codes and never alter the tool result.

Decision IDs encode the durable session ID and call ID with length prefixes, so the same call ID in two sessions remains distinct without a collision-prone local hash. Durable replay validates both projections, removes exact duplicate phases, rejects changed phase content or pair identity, and keeps either half of a missing pair explicitly `incomplete`.

The package stores opaque references, counts, closed statuses, and readiness flags. It excludes raw arguments, prompts, chain-of-thought, provider content, result content, credentials, URLs, media bytes, and thrown text. It does not change policy or write an index or reasoning bank.

## Alternatives considered

**Subscribe in a reasoning-bank plugin.** That would couple unproven capture fields to a downstream learning format before trace usefulness is measured. Capture remains independent, while a bank adapter stays deferred until the evaluation baseline exists.

**Merge the old experimental DSH trace branch.** That branch contains unrelated producer and bank assumptions and has diverged from current master. The package uses current ToolRuntime and Session extension points instead.

**Persist whole ToolRuntime inputs and outputs.** Raw values would broaden retention and make redaction dependent on every downstream reader. The producer instead emits an explicit bounded projection at the capture site.

## Consequences

Current DSH can record and replay deterministic decision pairs without changing the agent loop or model-visible data. Producer adapters remain separate work, and package fixtures do not establish live provider, persistence restart, overhead, reviewer, or delivery-receipt evidence. A reasoning bank remains outside this package until trace-driven evaluation establishes its inputs and promotion policy.
