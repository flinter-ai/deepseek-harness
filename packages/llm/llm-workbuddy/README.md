---
description: "The local WorkBuddy2API OpenAI-compatible provider adapter for DSH users and maintainers configuring the workbuddy route."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-workbuddy

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-llm-workbuddy` is the local WorkBuddy2API adapter for the harness LLM service: it registers a `workbuddy` route through the shared `llm-pi-ai` OpenAI-completions transport and exposes the separate gateway's fixed model catalog. It resolves the endpoint and credential reference from configuration, but it does not contain, launch, or manage the gateway process.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package when a composition must route model requests to a separately managed WorkBuddy2API gateway through the harness LLM service.

### Configure the route

The adapter uses a loopback endpoint and `WORKBUDDY_API_KEY` by default; set `baseURL`, `apiKeyEnv`, `displayName`, or `models` when the gateway deployment needs different connection facts.

```yaml
- name: '@deepseek-ai/dsh-llm-workbuddy'
  config:
    baseURL: http://127.0.0.1:8000/v1
    apiKeyEnv: WORKBUDDY_API_KEY
    models:
      - id: deepseek-v4-flash
        reasoningEfforts:
          off: none
          high: high
```

| Field | Default | Meaning |
|---|---|---|
| `displayName` | `workbuddy2api` | Label shown by the provider selector |
| `apiKeyEnv` | `WORKBUDDY_API_KEY` | Credential reference resolved for the gateway request |
| `baseURL` | `http://127.0.0.1:8000/v1` | OpenAI-compatible gateway endpoint |
| `models` | fixed WorkBuddy snapshot | Replaces the advertised model catalog when supplied |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-llm-workbuddy) is the exhaustive source for accepted fields and their defaults.

### Gateway boundary

The adapter owns route registration and request-profile construction; the separate `/Users/oldap/workbuddy2api` gateway owns provider credentials, upstream availability, and the actual HTTP service.

<a id="understand-the-implementation"></a>
## Understand the implementation

The package builds a `PiAiProviderProfile` with the OpenAI-completions protocol, resolves a configured model list or the fixed catalog, and lets the shared pi-ai adapter perform streaming, retry-policy, and credential-seam behavior.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Package entry and provider registration |
| [`src/config.ts`](src/config.ts) | Configuration schema and profile construction |
| [`src/catalog.ts`](src/catalog.ts) | Fixed model catalog and reasoning capabilities |
| [`src/invariant.ts`](src/invariant.ts) | Package-level invariants for route and catalog behavior |

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough.

- [llm-pi-ai adapter](../llm-pi-ai/README.md) — shared OpenAI-completions transport, credentials, streaming, and retry policy.
- [dsh-llm service](../llm/README.md) — provider-neutral service that registers the route.
- [WorkBuddy gateway handoff](../../../LOCAL-LLM-API-HANDOFF.md) — local gateway ownership and operational notes when available in the checkout.

<a id="model-experience"></a>
## Model Experience

### WorkBuddy request

#### What the model sees

The selected WorkBuddy model receives the harness system prompt, message history, tool schemas, and request options translated by the shared OpenAI-completions transport; the adapter contributes no extra prompt prose.

#### Token effect

The upstream WorkBuddy gateway determines tokenization and usage reporting; the fixed catalog describes model identity and reasoning capability but does not estimate provider billing.

#### KV Cache effect

The gateway owns prefix reuse, so changing the selected `model`, prompt history, tools, or request options can change its cache domain or reusable prefix.

### WorkBuddy response

#### What the model sees

Provider text, reasoning, tool-call, usage, and finish events are translated by `llm-pi-ai` into the harness stream protocol and become durable context only when the session loop records them.

#### Token effect

Reported input and output usage remains provider-owned; the adapter does not rewrite the gateway's accounting.

#### KV Cache effect

Recorded response content appends to later requests, while transport metadata and usage records do not themselves alter the model-visible prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The model catalog is a fixed snapshot** — update `src/catalog.ts` when the separately managed gateway changes its supported models.
- **The gateway is external** — this package does not launch, health-check, or fail over `/Users/oldap/workbuddy2api`.
- **The default endpoint is loopback-only** — a remote or differently bound endpoint requires explicit `baseURL` configuration and a separate security review.
- **Images are not added by this adapter** — image support depends on the shared transport and the gateway's own contract.

<a id="dev-note"></a>
### Dev Note

This Dev Note is non-authoritative working context; shipped behavior is defined by the package code, generated configuration catalog, tests, and sections above.

- Keep gateway credentials outside the repository and reference them through `apiKeyEnv`.
- Treat a catalog update as a contract change: update focused tests and the bilingual README pair together.
