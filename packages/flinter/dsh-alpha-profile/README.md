---
description: "FLINTER's Phase 1 provider/profile, worker-launch, and attempt-safety seam over the pinned DeepSeek Harness alpha."
kind: "package-library"
---

# @deepseek-ai/dsh-alpha-profile

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-alpha-profile` is the FLINTER-owned settings, worker-launch, and non-Orca attempt-safety layer over the pinned DeepSeek Harness alpha. It describes ARK, Modelflare, GMI Serving, and direct DeepSeek route references; records model-level context and output capacities; exposes selectable reasoning levels; binds a worker attempt to one DSH session and durable root; and provides fresh attempt roots, secret-free manifests, fencing, and canary checks. DSH remains the owner of the agent loop, session/event codec, provider construction, credential resolution, and tool runtime.

## Table of Contents

- [Use this package](#use-this-package)
- [Route and worker boundaries](#route-and-worker-boundaries)
- [Model Experience](#model-experience)
- [Attempt safety](#attempt-safety)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Use the profile when a host needs FLINTER's provider settings or needs to launch a worker from a control-plane stamped environment. The package emits credential references such as `ARK_PLAN_API_KEY`, never the secret values. A fresh session captures one provider/model route; UTC rotation affects only later fresh sessions. A replacement attempt must advance lease and attempt identity while retaining the same `dshSessionId` and `dshSessionRoot`.

`contextWindow` and optional `maxTokens` are model-level values in each route's `models` entry. They are not global reasoning declarations and do not claim that a live provider accepted a request. The `reasoningEfforts` option lets a deployment expose the levels it has verified for its endpoint; the default profile currently records the compatible `high` wire value for ARK and Modelflare.

## Route and worker boundaries

- ARK is the default fresh-session route during 16:00–24:00 UTC.
- Modelflare is the rotation route outside that window.
- GMI Serving is explicit-only; it is not automatic rotation.
- Direct DeepSeek remains the separate `dsh-llm-deepseek` route.
- AWS integration consumes the same credential references through an alpha-compatible provider seam; this package does not read or synchronize AWS secrets.
- Agent Teams, Runta, Beam, Tower, and the control plane remain separate capabilities.

## Model Experience

### Profile-selected request

#### What the model sees

The selected DSH model receives the normal native session history, current system prompt, tools, and user input. The profile contributes route selection and model capacity metadata such as `contextWindow`; it does not rewrite canonical session events or invent a parallel prompt history.

#### Token effect

The selected model's declared `contextWindow` and optional `maxTokens` constrain request assembly and output admission through DSH's native model configuration. Exact tokenization and provider acceptance remain provider-specific.

#### KV Cache effect

Fresh-session route selection is captured with the session. Reusing a session preserves its provider/model route, while changing the time-of-day default affects only a new session and therefore does not silently change an existing request prefix.

## Known Limitations and Deferred Work

- **Live provider capacity is not proven by configuration** — mock endpoints validate shape and selection; paid provider calls and AWS deployment remain separate evidence gates.
- **The current route catalog is intentionally narrow** — adding models or reasoning levels requires explicit endpoint verification and profile review.
- **Native DSH events remain the L0 trace seam** — downstream trace-link may consume them later, but this package does not extend the Session codec.

## Attempt safety

Use this package for non-Orca launch and attempt safety around the native DSH Agent and Session. The control-plane or executor integration must provide the authenticated callback path, cloud task identity, stop operation, and terminal-state observation.

The launch flow is `resolveWorkerAttemptRoots()` → `createWorkerAttemptRoots()` → `writeWorkerAttemptManifest()` → `buildDshAttemptLaunch()`. Pass the returned launch spec to a direct child-process API with `shell: false`; the task remains one literal argument. Use `fenceWorkerAttempt()` before starting a replacement, `cleanupWorkerAttempt()` only after its terminal proof, and `assertWorkerCanaryProof()` before enabling fan-out.

`attempt.ts` separates the durable `DSH_SESSION_ROOT` from per-attempt scratch and artifact roots, writes the launch manifest with an exclusive owner-only create, scrubs inherited credential-shaped environment names, and removes only ephemeral roots after a terminal fence. `lifecycle.ts` keeps physical executor fencing and logical lease fencing as separate checks.

<a id="understand-the-implementation"></a>
## Understand the implementation

The exact attempt and lifecycle contracts are exported from [src/attempt.ts](src/attempt.ts) and [src/lifecycle.ts](src/lifecycle.ts). DSH identity and create/resume binding remain in [src/worker.ts](src/worker.ts).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and deferred directions. It is explicitly non-authoritative; shipped behavior and limits live in the sections above and the package code. The acceptance suite for attempt and lifecycle safety is [tests/attempt.spec.ts](tests/attempt.spec.ts) and [tests/lifecycle.spec.ts](tests/lifecycle.spec.ts).

#### Future: richer route capability negotiation

Additional reasoning levels, provider-specific capacity overrides, and live provider health policy remain deferred until each endpoint has an explicit compatibility and evidence gate.

</details>
