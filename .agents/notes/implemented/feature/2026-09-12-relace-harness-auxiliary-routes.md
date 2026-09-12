# Agent Note: Relace auxiliary search and candidate apply in the DSH harness

Status: implemented

English | [中文](2026-09-12-relace-harness-auxiliary-routes.zh.md)

## Problem

DSH needs Relace Agent Search for fast repository understanding and Relace Apply-3 for a bounded code transformation. Search is a read-only multi-turn tool protocol, while Apply-3 is a separate one-shot candidate-producing request. Treating either as a normal runner provider would mix host filesystem authority, model-tool execution, candidate writes, and the DSH runner's default model policy.

## Decision

`dsh-llm-pi-ai` owns the harness adapters. It exports OpenRouter profiles for `relace/relace-search` and `relace/relace-apply-3`, with a shared `OPENROUTER_API_KEY` reference by default and an explicit factory for separate Search and Apply references. Profiles contain references only; they never contain secret values.

Search uses the five exact strict tools required by Relace: `view_file`, `view_directory`, `grep_search`, `bash`, and `report_back`. Its request builder supplies the documented system and user prompt shape, and `createRelaceSearchToolBridge()` validates arguments before dispatching to host callbacks. The host owns workspace path resolution, output bounds, read-only command allowlisting, cancellation, parallel execution, and the five-turn limit. The bridge has no write callback.

Apply-3 uses a separate one-shot request with no tools or response-format hint. The formatter emits the required `<code>` and `<update>` tags and an optional single-line `<instruction>`, rejects ambiguous closing tags, and applies a character guard below the documented provider input capacity. The parser returns candidate merged code and usage without writing it. The caller reviews the candidate, diff, and tests through the normal DSH write path.

The project skill at `.dsh/skills/relace-harness/SKILL.md` combines a configured Kimi coding/reasoning route with the two auxiliary routes. It may select the established `ark-agent-plan` / `kimi-k3` route only when the active profile exposes it; it does not invent a Relace Kimi provider or credential. The AWS worker overlay exposes optional JSON references for shared or separately vaulted OpenRouter Relace credentials and remains `allowWrites: false`.

## Alternatives considered

**Modify the DSH runner or its default route.** Rejected because these are harness-level auxiliary capabilities and must not change the runner's normal model selection or local gateway behavior.

**Put Apply-3 inside the Search tool loop.** Rejected because Search is read-only exploration and Apply-3 produces a code candidate; combining them would blur tool authority and make an unreviewed write path tempting.

**Reuse Jacq's encrypted desktop session token as an API key.** Rejected because the desktop token is not a documented Relace or OpenRouter API key and cannot be copied to AWS by inference.

## Consequences

The harness can compose Kimi, Search, and Apply-3 without changing the canonical DSH runner branch. A deployment may use one OpenRouter key or independently rotate two route references. Missing credential references fail only when the opt-in route is selected; no secret is required for keyless unit tests. The host still must supply actual callback implementations and enforce the turn bound, so adapters and tests do not claim a live provider E2E.

## Testing

The Relace and conversion suites pass with 81 tests, the `llm-pi-ai` TypeScript build passes, and the AWS worker profile test passes with the three optional OpenRouter secret mappings. No provider credential was printed or stored in source, the project skill, or test fixtures.
