---
description: "Independent DSH plugin that gives Ark and other runners bounded FLINTER packet evidence while keeping Jacq materialization host-only."
kind: "package-reference"
---

# @deepseek-ai/dsh-packet-evidence

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-packet-evidence` attaches FLINTER's canonical packet-evidence contract to a DSH composition. It is an independent package in the DSH package graph, so Ark, Jacq, Devin ACP, or another runner can load it without importing a Search-R1 worktree. Model-facing calls carry only an opaque `packet_id`, caller-selected references, and explicit bounds; the configured process owns reference validation, provenance checks, and truncation. Jacq receives the same contract through a host-only bounded snapshot operation. The plugin adds a child-process call per request in this MVP and does not claim a live provider run.

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

Mount this plugin in the DSH composition that owns the model-facing agent. Point it at the Search-R1 `packet_registry_service.py` process, or at a compatible implementation of `packet-registry-service-v1`. The service's trusted registry root stays in host configuration and is never sent to the model.

### When to choose it

Choose this package when a DSH runner needs bounded, auditable evidence access without putting a full trace or filesystem path in a tool call. Use its dynamic tools for an Ark-style runner that can ask for another evidence slice. Use `PacketEvidenceClient.materializeJacq()` for Jacq-style execution that needs a bounded snapshot before the run. Devin ACP can use the same client or a future ACP adapter; this package does not couple itself to any one runner.

### Minimal configuration

```ts
import PacketEvidence from '@deepseek-ai/dsh-packet-evidence'

await ctx.plugin(PacketEvidence, {
  command: 'python3',
  args: ['/path/to/packet_registry_service.py'],
  registryRoot: '/trusted/packet-registry',
  timeoutMs: 30_000,
  maxResponseBytes: 128_000,
})
```

| Field | Default | Meaning |
|---|---|---|
| `command` | required | Executable that serves `packet-registry-service-v1`. |
| `args` | `[]` | Arguments before the plugin appends the trusted registry-root flag. |
| `registryRoot` | required | Host-side canonical packet registry root. |
| `cwd` | `''` | Optional host-side child-process working directory. |
| `timeoutMs` | `30000` | Per-request process deadline. |
| `maxResponseBytes` | `128000` | Maximum accepted service response size. |
| `toolPrefix` | `flinter_` | Prefix for model-facing tool names. |

The generated [configuration catalog](../../../docs/config-catalog.md) is the exhaustive source for accepted fields and their JSDoc; its package-specific anchor is added when the catalog is regenerated from this package.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design boundary

The Search-R1 process is the canonical evidence owner. This package is a transport and DSH presentation adapter: it starts one short-lived child for a request, sends a small JSONL message, validates the response, and renders a bounded JSON tool result. It does not select evidence, calculate packet identity, read the source trace, or implement a second truncation algorithm.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Config schema, bounded process client, DSH tool registration, and host-only Jacq method. |
| [`src/invariant.ts`](src/invariant.ts) | Package-owned invariant companion for the DSH test host. |
| [`tests/index.spec.ts`](tests/index.spec.ts) | Compact-request, process-boundary, tool-surface, timeout, and response-bound tests. |
| [`tests/fixtures/packet-service.mjs`](tests/fixtures/packet-service.mjs) | Deterministic protocol fixture; it is not a provider or evidence implementation. |

The public dynamic methods are `packet_describe` and `evidence_get`. `materialize_jacq` is deliberately host-only: it returns a bounded snapshot for Jacq compatibility but is not exposed as a model tool. Requests preserve caller order and duplicates; the canonical service performs stable dedupe and applies its own bounds.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- Search-R1 packet registry service in the separate FLINTER repository — canonical packet and evidence semantics.
- [Alpha profile](../dsh-alpha-profile/README.md) — optional DSH composition and worker lifecycle profile.
- [DSH tools](../../core/tools/README.md) — model-facing tool registration and result presentation.
- [DSH ACP](../../acp/acp/README.md) — automation transport that can consume a mounted composition.

-----

<a id="model-experience"></a>
## Model Experience

### Packet evidence tools

#### What the model sees

The model sees `flinter_packet_describe` and `flinter_evidence_get` with JSON arguments for an opaque `packet_id`, optional evidence refs, and explicit character/item bounds. Results preserve recorded evidence status, provenance, and truncation; a valid empty result remains different from a service error. Full traces, manifest paths, registry roots, credentials, and source artifact paths are not model inputs.

#### Token effect

Only the bounded JSON result returned by the selected call enters the session. The plugin sends no full trace and makes no extra model request; the child-process response limit is separate from the evidence character limits.

#### KV Cache effect

Tool schemas and the short guidance section are stable for a composed session. Evidence results append only when the model calls a tool, so repeated calls reuse the unchanged prefix until the DSH session changes its tool surface or route.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One short-lived child per request** — the MVP favors isolation over a persistent service connection; a later host may add a supervised pool without changing the evidence contract.
- **Local process boundary only** — MCP, HTTP, and SDK transports are not implemented here; they should wrap the same `packet_describe` and `evidence_get` operations.
- **No provider claim** — package tests use a deterministic protocol fixture and do not establish Ark, Jacq, Devin ACP, RDS, Octen, or live model availability.
- **Canonical registry required** — the configured service must resolve the packet ID and enforce its own source/hash and evidence bounds.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep this package in the DSH repository. Do not copy Search-R1 source, link a Search-R1 worktree, expose the original trace, or move provider-specific adapter code into the Search-R1 branch. The next transport adapter should call the same configured service and retain packet identity, source hash, view hash, and truncation metadata.

</details>
