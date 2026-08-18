# credentials/ — credential references

English | [中文](README.zh.md)

The credential capability family separates reference resolution from its provider:

| Package | Role | ctx key |
|---|---|---|
| [`credentials/`](credentials/README.md) | Credential-reference seam | `ctx.credentials` |
| [`credentials-local/`](credentials-local/README.md) | Environment and local-file provider | registers `ctx.credentials` |
| [`dsh-credentials-aws-secrets-manager/`](dsh-credentials-aws-secrets-manager/README.md) | AWS Secrets Manager provider | registers `ctx.credentials` |

Configuration carries references, not secret values. Consumers resolve those references at their operation boundary; the child READMEs own mutation, precedence, and storage semantics.

The subsystem reference — `CredentialRef`, per-operation resolution, UI-safe `CredentialInfo`, provider layers — is [docs/subsystems/credentials.md](../../docs/subsystems/credentials.md).

## How to add keys

### Local development

Use `dsh-credentials-local`. Keys live in `~/.dsh/.credentials.yaml` as a YAML mapping:

```yaml
DEEPSEEK_API_KEY: sk-…
OPENCODE_GO_API_KEY: sk-…
KIMI_CODING_API_KEY: sk-…
```

You can also write them through the DSH Models UI; the file is created with mode `0600`.

### AWS Bedrock

Bedrock does **not** use an API key. It authenticates through the AWS credential chain (IAM task role, instance profile, `AWS_PROFILE`, etc.). There is no "Bedrock key" to add.

To make Bedrock available, declare the provider in `settings.yaml`:

```yaml
llm-pi-ai:
  providers:
    amazon-bedrock:
      region: us-west-2   # optional
      profile: production # optional
```

There is no separate enable/disable switch. If `amazon-bedrock` appears in `providers`, DSH registers it; remove the entry to disable it. Route requests to `provider: amazon-bedrock` to use it.

### Third-party API keys in AWS

Store them in AWS Secrets Manager and mount the AWS credentials provider:

```yaml
# cordis.yml or settings.yaml
credentials:
  provider: aws-secrets-manager
  config:
    secretPrefix: /dsh/
    secretFormat: json
```

Create one secret per key:

```bash
aws secretsmanager create-secret \
  --name /dsh/THIRD_PARTY_API_KEY \
  --secret-string '{"THIRD_PARTY_API_KEY":"sk-…"}'
```

DSH resolves `THIRD_PARTY_API_KEY` at request time from Secrets Manager. No local credential file is needed in the container.
