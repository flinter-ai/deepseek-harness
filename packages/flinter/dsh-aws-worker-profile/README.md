---
description: "Public read-only AWS credential profile layer over the same DSH alpha bundles used by local tod."
kind: "package-bundle"
---

# @deepseek-ai/dsh-aws-worker-profile

English | [中文](README.zh.md)

## Summary

This public profile bundle connects an AWS worker to the same DSH alpha composition used by local `tod`. It changes one thing: it disables the base profile's local credential provider and inserts `@deepseek-ai/dsh-credentials-aws-secrets-manager` in read-only mode. DSH still owns the harness, Agent, Session, model/provider routing, tools, native events, and persistence.

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

Install this bundle into an initialized source-checkout profile that already contains `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-headless`:

```sh
pnpm dsh plugin --profile headless add ./packages/flinter/dsh-aws-worker-profile
```

The bundle's patch contains only public secret-name mappings. Secret contents, AWS credentials, regions, account identifiers, and IAM policy are supplied outside this repository by the runtime environment. The bundle does not contact AWS merely because it is installed.

<a id="understand-the-implementation"></a>
## Understand the implementation

The runtime content is [`cordis.patch.yml`](cordis.patch.yml). It replaces one `credentials` row and inserts one public AWS provider row. It does not include a second base bundle, a second CLI, a second Agent, or a second Session implementation.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Thin profile overlay over the standard DSH bundles. |
| [`src/index.ts`](src/index.ts) | Empty module entry; the patch is the runtime content. |
| [`src/invariant.ts`](src/invariant.ts) | Static invariant companion with no secret access. |
| [`tests/profile.spec.ts`](tests/profile.spec.ts) | Verifies public metadata, mappings, and no placeholder secret material. |

<a id="further-exploration"></a>
## Further Exploration

- [AWS credential provider](../../credentials/dsh-credentials-aws-secrets-manager/README.md) — request-time reference resolution.
- [FLINTER alpha profile](../dsh-alpha-profile/README.md) — shared route, context, reasoning, worker, and attempt contracts.
- [Base bundle](../../bundle/base/README.md) — the DSH composition this layer patches.

<a id="model-experience"></a>
## Model Experience

### What the model sees

The same native DSH session, system prompt, tools, and provider route as local `tod`. Secret values are used for request authorization and are not emitted into session events or model context.

### Token effect

None. This bundle adds no prompt text or context records.

### KV Cache effect

None. Swapping credential source does not change canonical session history.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Mock evidence only in Phase 1** — AWS SDK calls and IAM permissions are not proven by this public bundle test.
- **Read-only by default** — secret writes require a separately reviewed deployment configuration.
- **No downstream port** — trace-link, agentic-control, segment, PES, executor/Runta, Tower, Beam, and control-plane integration remain later gates.

<a id="dev-note"></a>
### Dev Note

Keep all secret values, account identifiers, private endpoints, IAM documents, environment dumps, and AWS runtime evidence outside this public source package.
