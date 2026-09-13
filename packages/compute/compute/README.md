---
description: "Compute capability seam for explicit EC2, Sandpack preview, and future DSH backends."
kind: "package-reference"
---

# @deepseek-ai/dsh-compute

English | [中文](README.zh.md)

This package defines the optional `ctx.compute` seam. A host mounts one concrete provider behind it and can then switch between an EC2 process backend, a Sandpack browser preview backend, or a future backend without changing Web draft/publish consumers. This package does not own workspace storage, authentication, Git, PR writes, or a remote EC2/Sandpack client.

The seam carries a workspace reference, an explicit operation, credential references, a bounded lease, and a pollable run handle. Command requests use exact argv rather than shell strings; preview requests carry source files and an entry point. Raw credential values are not fields in this API, and output is explicitly bounded.

Backend selection is explicit. Set `DSH_COMPUTE_BACKEND=ec2` for an EC2 host or `DSH_COMPUTE_BACKEND=sandpack` for a browser preview composition, or provide the equivalent host config. There is no automatic fallback from EC2 to Sandpack or from Sandpack to EC2, so a deployment cannot silently change its compute semantics.

```yaml
backend: ec2
capabilities:
  operations: [command]
  persistentWorkspace: true
  storage: aws
  network: restricted
  maxConcurrentRuns: 1
```

`DelegatingComputeProvider` is the small adapter for a host that already owns its remote client. The host supplies the five lifecycle callbacks and remains responsible for storage durability, credential resolution, admission limits, and process or browser policy. The provider must reject an operation it did not advertise and must fence leases and run handles to its own backend.

## Model Experience

### Compute selection

#### What the model sees

The model-facing layer sees the selected backend's capabilities and bounded run status. It does not receive host credentials, storage credentials, or an implicit cross-backend fallback.

##### Runtime contract

```markdown
explicit backend -> bounded lease -> exact operation -> pollable run
```

#### Token effect

Backend identity and run status contribute only the metadata a host chooses to render. Source files, logs, and credentials are not automatically copied into the model context by this seam.

##### Prompt effect

```markdown
capabilities and bounded status are opt-in context
```

#### KV Cache effect

Changing compute capacity or backend status does not change the stable model prefix unless a consumer explicitly renders that metadata into a prompt.

##### Stable prefix

```markdown
compute lifecycle stays outside model messages by default
```
