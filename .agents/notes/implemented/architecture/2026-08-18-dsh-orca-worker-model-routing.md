# Agent Note: DSH-Orca worker model routing

Status: implemented

English | [中文](2026-08-18-dsh-orca-worker-model-routing.zh.md)

## Problem

The `examples/dsh-orca/` bridge turns a DeepSeek Harness (DSH) agent into an Orca-orchestrated worker. A worker home selects one primary model and the launcher delegates a task to it. Model failures are expected: provider quotas, credit exhaustion, transient HTTP errors, and transport-level streaming failures all occur against live gateways. Without a declared fallback, every such failure becomes a manual re-dispatch and the worker terminal must be re-created.

At the same time, the routing policy must not invent provider identities or compound model ids. A gateway such as `opencode-go` can host models that speak different wire protocols, and the harness's current pi-ai adapter selects the protocol at the provider level. A model that needs a different protocol cannot be forced through by renaming the provider.

## Decision

### Fixed desired routing with operational fallback

`examples/dsh-orca/worker-home.mjs` declares a closed routing table:

- `easy` primary: `opencode-go / gpt-5.6-luna`.
- `easy-backup` and `backup`: `gmi-serving / deepseek-ai/DeepSeek-V4-Flash-0731`.
- `hard` and `kimi`: `kimi-coding / k3-256k`.
- `hard-backup` and `glm-5.3`: `opencode-go / glm-5.3`.

`dsh-agent.mjs` retries once with the configured fallback when the primary model fails with an eligible provider or transport error. `easy` falls back to `easy-backup`; `hard` falls back to `hard-backup`. The fallback is not a routing change: it is an operational measure executed when the primary route is unavailable.

### gpt-5.6-luna is kept as primary and marked BLOCKED

`gpt-5.6-luna` is configured as the `easy` primary and is listed in the `opencode-go` explicit model catalog with its real card values. A `BLOCKED` comment records that it terminates correctly only on the OpenAI Responses API, while `opencode-go` is pinned to OpenAI chat/completions so that `glm-5.3` and the other explicit models work. DSH pi-ai currently selects `api` at the provider level, so a single `opencode-go` provider cannot mix the two protocols.

The first `easy` attempt therefore fails with a transport/finish-reason error, the fallback classifier retries with `easy-backup`, and the task completes against GMI-serving. The desired route stays explicit; the fallback is temporary until a DSH-side capability supports per-model protocol selection.

### Fallback eligibility classifier

A failure is fallback-eligible when the captured output contains:

- quota, balance, credit, or authorization errors;
- HTTP signals `429` or `404`;
- unsupported-model or invalid-model errors;
- transport failures such as `stream ended`, `finish_reason`, or `transport`.

`NO_ADAPTER` and local configuration errors are deliberately **not** fallback-eligible. Retrying a missing adapter or a broken local config under a different model id cannot succeed and would only delay reporting the real problem.

## Alternatives considered

**Switch `easy` to GMI-serving as the operational primary.** This would make tests green immediately, but it would hide the desired route and make the fallback the de-facto policy. The routing table records intent; the fallback executes the exception.

**Create a pseudo-provider such as `opencode-go-responses`.** This was tried and reverted. Provider identity and wire protocol are separate concerns, and inventing provider names leaks protocol selection into the provider namespace.

**Remove `gpt-5.6-luna` from the catalog until DSH supports it.** This would also hide the desired state and make the routing table inexplicable. Keeping the model entry with a `BLOCKED` comment makes the constraint visible and grep-able.

**Retry every failure indiscriminately.** Retrying `NO_ADAPTER` or syntax errors in `settings.yaml` cannot help and wastes provider budget on what is clearly a local misconfiguration.

## Consequences

- The desired routing is stable and user-visible in `worker-home.mjs` and `README.md`.
- Operational tasks dispatched with `--model easy` complete through `easy-backup` until DSH supports per-model `api` selection.
- The fallback classifier is guarded by a unit test in `examples/dsh-orca/tests/classifier.spec.ts`.
- No provider identity is invented; `opencode-go` remains one provider with one explicit protocol.
