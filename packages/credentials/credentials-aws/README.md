---
description: "Read-only AWS Secrets Manager provider for the DSH credential seam."
kind: "package-reference"
---

# @deepseek-ai/dsh-credentials-aws

English | [中文](README.zh.md)

This optional provider reads a JSON `SecretString` from AWS Secrets Manager and
serves it through the existing `ctx.credentials` contract. The secret maps
credential references such as `OPENROUTER_API_KEY` to non-empty string values.

The inherited process environment wins and remains read-only. AWS values are
kept in memory only, refreshed on a bounded interval, and never returned by
`describe()`, written to disk, or printed in diagnostics. Runtime writes and
credential records are deliberately unsupported. EC2 should use the instance
role/default AWS credential chain; no access keys belong in this package.

```yaml
secretId: flinter/dsh-runtime
region: us-east-2
refreshMs: 60000
```

Use the existing local provider for local `.credentials.yaml` development. A
composition must mount one `ctx.credentials` provider at a time. Mirroring or
rotating values is an explicit operator workflow, not an automatic runtime
side effect.

## Model Experience

### Credential resolution

#### What the model sees

The model-facing provider receives the resolved credential only at request time. Configuration and status surfaces see a reference and redacted presence facts, never the value.

##### Runtime contract

```markdown
credential reference -> resolve at request time -> provider request
```

#### Token effect

Credential references and status metadata add no model prompt tokens. Secret values are not inserted into prompts by this provider.

##### Prompt effect

```markdown
no credential value is added to the model context
```

#### KV Cache effect

Credential refresh is outside the model prompt prefix and does not change KV cache stability.

##### Stable prefix

```markdown
provider configuration remains outside model messages
```
