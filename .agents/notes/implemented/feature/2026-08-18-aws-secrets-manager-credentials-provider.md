# Agent Note: AWS Secrets Manager credentials provider

Status: implemented

English | [中文](2026-08-18-aws-secrets-manager-credentials-provider.zh.md)

## Problem

DSH agents running inside AWS containers need to resolve model API keys from AWS Secrets Manager rather than from a local credentials file. The existing `dsh-credentials-local` provider reads `$DSH_HOME/.credentials.yaml`, which is correct for local development but wrong for a container whose secrets are provisioned through AWS IAM and Secrets Manager. The model side (`llm-pi-ai`, routing, fallback) is unchanged; only the key source changes.

## Decision

### New package: `dsh-credentials-aws-secrets-manager`

A new sibling package under `packages/credentials/` implements the `CredentialProvider` seam over AWS Secrets Manager. It is a new directory with no upstream-sync conflict surface, following the operating model that core features merge to master and deployment branches carry only wiring.

### Reference-to-secret mapping

Each `CredentialRef` maps to a secret named `<secretPrefix><ref>`. The payload may be a plain string (`secretFormat: plain`) or a JSON object (`secretFormat: json`, the default). For JSON payloads, the reference name itself is the default field, so `{"DEEPSEEK_API_KEY":"sk-…"}` resolves for `DEEPSEEK_API_KEY` without extra configuration; `jsonField` overrides the field when the deployment uses a different key.

### AWS-native credential resolution

The provider uses `@aws-sdk/client-secrets-manager` and resolves AWS credentials through the standard credential chain: environment variables, `AWS_PROFILE`, ECS task roles, and web identity tokens. Inside AWS, no stored key is required. `region` and `profile` are optional Config fields; omission defers to the SDK default chain.

### Writes

`set` creates the secret when absent (`CreateSecret`) and updates it otherwise (`PutSecretValue`). `unset` force-deletes the secret. Both emit `credentials/updated` after the commit.

## Alternatives considered

**Extend `dsh-credentials-local` with an AWS backend.** The local provider's file layering, watcher lifecycle, and permission model are local-development concerns. Mixing AWS API calls into that package would couple two unrelated storage backends and complicate both. A sibling package keeps each provider focused.

**Use environment variables injected by the container orchestrator.** ECS/Fargate can inject secrets as environment variables, but that exposes them to every process in the container and makes rotation invisible to the running process. Secrets Manager keeps the values out of the environment and lets the app re-resolve per operation.

**Cache resolved secrets in memory.** Caching would reduce API calls but stale secrets would persist until restart. The seam's contract is per-operation resolution; a deployment that needs caching can add it at a higher layer.

## Consequences

- A DSH agent in ECS/Fargate/AgentBox resolves model keys from Secrets Manager with zero local credential files.
- Local development continues to use `dsh-credentials-local`; the two providers are interchangeable through the same `ctx.credentials` seam.
- The package adds one external dependency (`@aws-sdk/client-secrets-manager`) and no changes to existing packages.
- Hot reload is not implemented: Secrets Manager has no filesystem watcher, so external rotation reaches the next `resolve` but does not emit `credentials/updated`.

## Testing

- `packages/credentials/dsh-credentials-aws-secrets-manager/tests/aws-secrets-manager.spec.ts` covers plain and JSON resolution, default and overridden JSON fields, missing secrets, empty fields, invalid JSON, `describe`, `set` create/update, and `unset` delete/ignore-missing.
- The full `packages/credentials/` suite passes (80 tests).
