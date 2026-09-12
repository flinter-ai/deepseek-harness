---
description: "Public, read-by-default AWS Secrets Manager credential-reference provider for the DeepSeek Harness alpha."
kind: "package-reference"
---

# @deepseek-ai/dsh-credentials-aws-secrets-manager

English | [中文](README.zh.md)

## Summary

This package is the public AWS credential-source adapter for the pinned DSH alpha. It implements the same `ctx.credentials` reference seam as the local provider. DSH settings carry names such as `ARK_PLAN_API_KEY`; the adapter resolves the corresponding AWS Secrets Manager value at request time. No secret value, AWS account, private endpoint, or deployment credential is stored in this package.

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

Mount it in an AWS worker profile after disabling the base profile's local credential row:

```yaml
- id: credentials
  disabled: true
- insert:
    - id: credentials-aws-secrets-manager
      name: '@deepseek-ai/dsh-credentials-aws-secrets-manager'
      config:
        secretNames:
          ARK_PLAN_API_KEY: flinter/dsh-ark-agent-plan
          MODELFLARE_API_KEY: flinter/dsh-modelflare
          GMI_SERVING_API_KEY: flinter/dsh-gmi-serving
          DEEPSEEK_API_KEY: flinter/dsh-deepseek-official
          OPENROUTER_API_KEY: flinter/dsh-openrouter
          OPENROUTER_RELACE_SEARCH_API_KEY: flinter/dsh-openrouter-relace-search
          OPENROUTER_RELACE_APPLY_API_KEY: flinter/dsh-openrouter-relace-apply-3
        secretFormat: json
        allowWrites: false
```

The names above are public routing metadata. The secret contents are supplied only by the AWS Secrets Manager service. A JSON secret uses the reference name as its field:

```json
{"ARK_PLAN_API_KEY": "<value supplied outside this repository>"}
```

The default profile is read-only for AWS references. `resolve` and `describe` perform request-time reads through the standard AWS SDK credential chain. `set` and `unset` fail closed unless a separately reviewed deployment explicitly enables `allowWrites`. The provider also keeps the DSH browser-session grant record in process-local memory; it never writes that record to AWS, and it is recreated on the next DSH process start.

The three OpenRouter references above are optional harness routes. The shared
`OPENROUTER_API_KEY` reference can serve both Relace Search and Apply-3, or the
two route-specific references can be vaulted and rotated independently. The
provider only resolves the named reference; it does not know or copy Jacq's
encrypted desktop session credential.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `region` | AWS SDK chain | Optional AWS region override. |
| `secretPrefix` | `/dsh/` | Fallback prefix for unmapped references. |
| `secretNames` | `{}` | Explicit public reference-to-secret-name mapping. |
| `secretFormat` | `json` | `json` selects a field; `plain` uses the whole string. |
| `jsonField` | reference name | Optional common JSON field override. |
| `allowWrites` | `false` | Enables destructive `set`/`unset` only when explicitly reviewed. |

<a id="understand-the-implementation"></a>
## Understand the implementation

The provider owns only the AWS-backed reference lookup. DSH still owns the agent loop, sessions, native events, model/provider selection, and request assembly. The FLINTER alpha profile owns the route-to-secret-name mapping. Local `tod` and AWS workers therefore use one DSH installation and one set of route references; only the credential provider row changes.

Browser-session record operations are process-local and never write to Secrets Manager; model API keys remain AWS references resolved at request time. Browser authorization records are recreated when the DSH process starts.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | AWS reference resolution, public mapping configuration, read-only guard, and lifecycle. |
| [`src/invariant.ts`](src/invariant.ts) | Static invariant companion; it registers no secret-related runtime behavior. |
| [`tests/aws-secrets-manager.spec.ts`](tests/aws-secrets-manager.spec.ts) | Mocked SDK contract tests; no AWS account or live secret is used. |

<a id="further-exploration"></a>
## Further Exploration

- [Credential reference seam](../credentials/README.md) — the DSH API implemented here.
- [Local credential provider](../credentials-local/README.md) — the local `tod` backend and file semantics.
- [FLINTER alpha profile](../../flinter/dsh-alpha-profile/README.md) — one shared route and worker composition.
- [AWS SDK credential chain](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html) — external runtime authentication configuration.

<a id="model-experience"></a>
## Model Experience

### Credential-reference request

#### What the model sees

Nothing new. The model receives the normal DSH request assembled from its native session and selected route. Secret values are resolved for the provider request and are not added to the session event stream or model context.

#### Token effect

None. This package contributes no prompt text or context records.

#### KV Cache effect

None. A credential rotation changes the next request's authorization only; it does not change canonical session history.

##### Cache-stability note

```markdown
Credential values and provider authorization metadata are not appended to the model context.
```

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Mock evidence only in Phase 1** — the component suite proves the adapter contract without claiming AWS deployment or IAM proof.
- **No external-rotation event** — Secrets Manager does not provide the local file watcher's update event through this package; the next request resolves the current value.
- **No durable record store** — browser-session grants are process-local; durable API-key records are not supplied by this adapter.
- **No AWS state is written by the alpha profile** — the profile sets `allowWrites: false`; deployment write access requires a later explicit review.

<a id="dev-note"></a>
### Dev Note

This package is deliberately public and provider-neutral at the composition boundary. Keep secret values, account identifiers, IAM policy documents, private endpoints, and environment dumps outside Git, tests, logs, and evidence artifacts.
