---
description: "FLINTER's Phase 1 provider/profile and worker-launch seam over the pinned DeepSeek Harness alpha."
kind: "package-reference"
---

# @deepseek-ai/dsh-alpha-profile

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-alpha-profile` is the FLINTER-owned settings and worker-launch layer over the pinned DeepSeek Harness alpha. It describes ARK, Modelflare, GMI Serving, and direct DeepSeek route references; records model-level context and output capacities; exposes selectable reasoning levels; and binds a control-plane worker attempt to one DSH session and durable root. DSH remains the owner of the agent loop, session/event codec, provider construction, credential resolution, and tool runtime.

## Table of Contents

- [Use this package](#use-this-package)
- [Route and worker boundaries](#route-and-worker-boundaries)
- [Model Experience](#model-experience)
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

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and deferred directions. It is explicitly non-authoritative; shipped behavior and limits live in the sections above and the package code.

#### Future: richer route capability negotiation

Additional reasoning levels, provider-specific capacity overrides, and live provider health policy remain deferred until each endpoint has an explicit compatibility and evidence gate.

</details>
