# dsh-credentials-aws-secrets-manager

English | [中文](README.zh.md)

AWS Secrets Manager [credentials](../credentials/README.md) provider for the DeepSeek Harness.

Each credential reference maps to one Secrets Manager secret named `<prefix><ref>`. The payload may be a plain string or a JSON object; when it is JSON, the reference name itself is the default field, so `{"DEEPSEEK_API_KEY":"sk-…"}` resolves for `DEEPSEEK_API_KEY` without extra configuration.

Credentials authenticate through the standard AWS credential chain — environment variables, `AWS_PROFILE`, ECS task roles, and web identity tokens — so a container running in AWS needs no stored key. `region` and `profile` are optional overrides for the default chain.

## Config

| Field | Default | Meaning |
|---|---|---|
| `region` | SDK default | AWS region for the Secrets Manager client. |
| `profile` | SDK default | AWS profile for the credential chain. |
| `secretPrefix` | `/dsh/` | Prefix prepended to every reference to form the secret name. |
| `secretFormat` | `json` | Payload shape: `plain` for a raw string, `json` for a JSON object. |
| `jsonField` | the reference name | JSON property that carries the value when `secretFormat` is `json`. |

## Secret shape

A plain secret holds the value directly:

```text
sk-…
```

A JSON secret holds the value under the reference name (or `jsonField`):

```json
{"DEEPSEEK_API_KEY": "sk-…"}
```

An absent secret resolves as unconfigured. An empty string, a missing JSON field, or a non-string JSON value is absent. Invalid JSON under `json` format fails resolution loud.

## Writes

`set` creates the secret when it does not exist (`CreateSecret`) and updates it otherwise (`PutSecretValue`). `unset` force-deletes the secret. Both emit `credentials/updated` after the commit.

## Model Experience

Indirectly, through the consuming LLM adapters: stored values authorize their provider requests, and the adapter owns every model-visible surface.

#### KV Cache effect

No direct invalidation; credentials never enter a request prefix.

## Known Limitations and Deferred Work

- **No hot reload** — Secrets Manager does not emit filesystem events; a rotated secret reaches the next resolution, but there is no `credentials/updated` fan-out on external rotation. The local provider's file watcher remains the hot-reload path for development.
- **No caching** — every `resolve` performs a `GetSecretValue` call. A deployment that resolves many references per second should front Secrets Manager with a local cache layer.
- **Binary secrets are not read** — `SecretBinary` payloads are ignored; the provider reads `SecretString` only.
