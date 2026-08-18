# Agent Note: Per-model API selection for pi-ai providers

Status: proposed

English | [中文](2026-08-18-per-model-api-selection-pi-ai.zh.md)

## Problem

`dsh-llm-pi-ai` currently selects the wire protocol at the provider level. A profile such as `opencode-go` names one `api` value — today `openai-completions` — and every model on that route speaks that protocol. This is correct when a gateway exposes one protocol per provider, but it breaks when a single gateway mixes protocols.

The live example is `opencode-go`:

- `gpt-5.6-luna` terminates correctly only on the OpenAI Responses API.
- `glm-5.3`, `kimi-k3`, and `kimi-k2.7-code` speak OpenAI chat/completions.

Because the route can only pin one protocol, `examples/dsh-orca/` keeps `gpt-5.6-luna` as the desired `easy` primary and relies on an operational fallback to `gmi-serving` when Luna fails. This is a workaround, not a solution.

A separate isolated diagnostic also showed that a config-declared provider with `api: openai-responses` fails with `NO_ADAPTER: no adapter registered for provider`, even though the pi-ai protocol table lists `openai-responses`. The Responses adapter path for config-declared providers therefore needs diagnosis before per-model protocol selection can be evaluated.

## Proposal

### Step 1 — Diagnose the `openai-responses` NO_ADAPTER path

Investigate why a hand-declared `llm-pi-ai` provider with `api: openai-responses` does not register an adapter, while `openai-completions` does. Likely starting points:

- `packages/llm/llm-pi-ai/src/provider.ts` — `buildProvider` and the `PROTOCOLS` table.
- `packages/llm/llm-pi-ai/src/config.ts` — `assertServiceable` and model resolution around the configured `api`.
- `packages/llm/llm/src/index.ts` — adapter registration and `NO_ADAPTER` emission.

Acceptance: an isolated DSH home with a config-declared `opencode-go` route using `api: openai-responses` and `gpt-5.6-luna` can at least reach network I/O and fail with a provider/model error rather than `NO_ADAPTER`.

### Step 2 — Evaluate per-model `api` override

If the Responses adapter path is healthy, evaluate the minimal delta that lets one provider route host mixed protocols:

- Allow `model.api` in the explicit `models` list and in `modelOverrides`.
- Resolve each model's effective API as `model.api ?? provider.api`.
- Ensure `buildProvider` and `resolveRouteModels` handle a route whose models do not all share one protocol.
- Reject incompatible `compat` switches per model with the existing diagnostics (e.g., reasoning-format switches are only valid on `openai-completions`).

If the Responses adapter path is not healthy, fix it first; do not layer per-model selection on top of a broken adapter registration.

### Step 3 — Validate the Orca example routing

Once per-model `api` is supported, update `examples/dsh-orca/worker-home.mjs`:

- Set `gpt-5.6-luna`'s model entry to `api: openai-responses`.
- Keep `opencode-go` pinned to `openai-completions` as the route default.
- Verify that `easy` succeeds directly without needing the `easy-backup` fallback.

## Alternatives considered

**Keep the operational fallback indefinitely.** The fallback works, but it consumes two provider calls and one failure for every `easy` task. It also hides the real capability mismatch from users reading the routing table.

**Split `gpt-5.6-luna` into a separate provider route.** This was tried as `opencode-go-responses` and rejected: provider identity should reflect the upstream gateway, not the wire protocol. Two routes for one gateway also duplicate credentials, headers, and base URL configuration.

**Make the provider dynamically detect the protocol from the model id.** Detection heuristics are fragile and silently wrong when a gateway changes its catalog. Explicit `api` fields fail loud and are reviewable in `settings.yaml`.

**Use pi-ai's installed catalog instead of explicit models.** The installed pi-ai catalog for `opencode-go` does not include all the models we need, and the explicit list is what makes `glm-5.3` callable today. Dropping explicit models is a regression.

## Acceptance criteria

- A config-declared provider with `api: openai-responses` registers an adapter and reaches network I/O.
- `model.api ?? provider.api` resolves the effective protocol for each model on a route.
- A single provider route can mix `openai-completions` and `openai-responses` models.
- `examples/dsh-orca/` `easy` routes directly through `opencode-go / gpt-5.6-luna` without falling back.
- Existing `glm-5.3` and `kimi-*` calls on `opencode-go` continue to use `openai-completions`.

## Risks

- The `openai-responses` NO_ADAPTER bug may be deeper than adapter registration (e.g., provider construction, schema validation, or lazy loading). A quick fix may not exist.
- Per-model protocol selection widens the configuration surface and the test matrix; every mixed-protocol route needs coverage.
- `compat` reasoning switches are valid only on `openai-completions`; the resolver must keep refusing invalid per-model combinations rather than silently skipping them.
- Provider-level discovery (`GET /v1/models`) is protocol-specific; a mixed route may need per-protocol discovery or hand-maintained model lists.
