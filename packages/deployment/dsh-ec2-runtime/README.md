---
description: "Private dependency root used to assemble the immutable DSH Web EC2 runtime artifact."
kind: "package-reference"
---

# @deepseek-ai/dsh-ec2-runtime

English | [中文](README.zh.md)

## Summary

This private package is a deployment composition root, not a second DSH application. Its production dependency closure contains the normal DSH CLI/Web runtime, the FLINTER alpha profile, and the AWS worker profile so CI can build one verifiable EC2 artifact without installing workspace dependencies on the host.

The direct roots also pin the AWS Secrets Manager provider, source draft, source controller, Sandpack editor, and host GitHub publisher in the closure; an upstream Web-bundle dependency change cannot silently remove those release contracts.

No runtime invariant companion is published because this private composition root contains no runtime invariant module.

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

### Contents

- `package.json` declares the runtime roots whose dependency closure is staged.
- `runtime-bootstrap.mjs` forwards to the normal `@deepseek-ai/dsh` CLI.
- `deploy/dsh-ec2/build-runtime-artifact.ts` creates and verifies the archive.

The package owns no credentials, settings, Git state, AWS policy, service unit, or persistent session data. Those remain host-owned and outside the immutable release directory.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

CI resolves the package closure from this private root, builds it once on the larger runner, and verifies the archive checksum and runtime entrypoint. EC2 extracts the resulting artifact and does not install workspace dependencies or rebuild the monorepo.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [EC2 deployment](../../../deploy/dsh-ec2/README.md) — artifact upload and activation.
- [AWS worker profile](../../flinter/dsh-aws-worker-profile/README.md) — host runtime composition.
- [Configuration catalog](../../../docs/config-catalog.md) — generated package metadata.

-----

## Model Experience

### Runtime composition context

#### What the model sees

The package contributes no new prompt, tool, or session content. It only makes the already-composed DSH CLI/Web, alpha profile, AWS worker profile, source draft/controller/editor, host publisher, and credential-provider packages available inside the release artifact.

##### Artifact composition

```markdown
@deepseek-ai/dsh-ec2-runtime
```

#### Token effect

None. Selecting this composition root changes the packaged runtime closure, not the request text sent to a model.

#### KV Cache effect

None. Artifact composition does not alter the canonical session prompt prefix; provider cache behavior remains owned by the selected DSH profile.

## Known Limitations and Deferred Work

- The first P0 closure still includes CodeSandbox dependencies because the alpha profile currently declares them as runtime dependencies. Splitting that backend into a lazy optional package is the planned P1 optimization.
- Artifact publication and EC2 activation remain deployment-layer work; this package does not create buckets, IAM roles, or systemd state.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
