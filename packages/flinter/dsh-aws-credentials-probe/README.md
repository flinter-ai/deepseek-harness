# `@flinter/dsh-aws-credentials-probe`

Status: **PHASE1_LOCAL_MOCK_ONLY**.

This is a compatibility probe over alpha’s `CredentialProvider` seam. It uses
an injected Secrets Manager-shaped reader, resolves model credentials at
request time, reports metadata without values, and rejects writes. It never
contacts AWS, projects `.credentials.yaml`, registers a production profile, or
handles GMI AgentBox infrastructure credentials; those remain a separate
namespace for a later AWS implementation.

## Model Experience

### Request-time credential seam

#### What the model sees

No credential value is model-visible. `@flinter/dsh-aws-credentials-probe` supplies metadata and request-time key resolution to the alpha seam without changing model selection or prompts.

#### Token effect

Credential resolution changes no prompt or token accounting.

#### KV Cache effect

Credential resolution registers no cache policy and does not alter cache usage.
