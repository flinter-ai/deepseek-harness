# Agent Note: Per-model API selection for pi-ai providers

Status: implemented

English | [中文](2026-08-18-per-model-api-selection-pi-ai.zh.md)

## Problem

`dsh-llm-pi-ai` selected the wire protocol at the provider level. A profile such as `opencode-go` named one `api` value and every model on that route spoke that protocol. This broke when a single gateway mixed protocols.

The live example was `opencode-go`:

- `gpt-5.6-luna` terminates correctly only on the OpenAI Responses API.
- `glm-5.3`, `kimi-k3`, and `kimi-k2.7-code` speak OpenAI chat/completions.

Because the route could only pin one protocol, `examples/dsh-orca/` kept `gpt-5.6-luna` as the desired `easy` primary and relied on an operational fallback to `gmi-serving` when Luna failed. The workaround consumed two provider calls and one failure for every `easy` task.

## Decision

### Per-model `api` override

`PiAiModelProfile` and the corresponding `modelFields` schema now accept an optional `api` field naming one of the supported wire protocols. `resolveRouteModels` resolves each model's effective API as `entry.api ?? request.api ?? base?.api ?? routeApi`.

`buildProvider` inspects the resolved models. When every model speaks one protocol it constructs the provider with a single `ProviderStreams` implementation, as before. When the route mixes protocols it constructs a `Partial<Record<string, ProviderStreams>>` map keyed by `model.api` and hands it to pi-ai's `createProvider`, which dispatches each request to the implementation for that model's `api`.

The route-level `api` remains the default and the validation order is unchanged: an explicit route protocol that this build cannot serve still fails before per-model resolution is considered.

### `examples/dsh-orca` routing restored

`examples/dsh-orca/worker-home.mjs` declares `gpt-5.6-luna` with `api: openai-responses` on the `opencode-go` route while the route itself keeps `api: openai-completions`. The `easy` worker therefore routes directly through Luna without falling back to GMI-serving.

The fallback classifier and the `easy-backup` / `hard-backup` routes remain in place for genuine provider failures (quota, 404, unauthorized, transport errors).

## Alternatives considered

**Keep the operational fallback indefinitely.** The fallback worked, but it consumed two provider calls and one failure for every `easy` task and hid the capability mismatch from users reading the routing table.

**Split `gpt-5.6-luna` into a separate provider route.** This was tried as `opencode-go-responses` and rejected: provider identity should reflect the upstream gateway, not the wire protocol. Two routes for one gateway also duplicate credentials, headers, and base URL configuration.

**Make the provider dynamically detect the protocol from the model id.** Detection heuristics are fragile and silently wrong when a gateway changes its catalog. Explicit `api` fields fail loud and are reviewable in `settings.yaml`.

**Use pi-ai's installed catalog instead of explicit models.** The installed pi-ai catalog for `opencode-go` does not include all the models we need, and the explicit list is what makes `glm-5.3` callable. Dropping explicit models is a regression.

## Consequences

- A single provider route can mix `openai-completions`, `openai-responses`, and `anthropic-messages` models, each declared with its own `api`.
- `examples/dsh-orca` `easy` routes directly through `opencode-go / gpt-5.6-luna`; the acceptance test completes without fallback.
- Existing single-protocol routes behave identically because `model.api` is optional and the route-level `api` remains the default.
- `compat` reasoning switches remain valid only on `openai-completions` models; `resolveModelCompat` already validates per model.

## Testing

- `packages/llm/llm-pi-ai/tests/` passes (216 tests), including the existing catalog and adapter suites.
- An isolated DSH home with `opencode-go` declared as `api: openai-completions` plus `gpt-5.6-luna` at `api: openai-responses` reaches network I/O and completes a prompt directly.
- `examples/dsh-orca` acceptance run `run_5089c98e6e15` dispatched `--model easy`, executed Luna directly, and returned `worker_done(succeeded)`.
