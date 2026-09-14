---
description: "Host and browser APIs for saving versioned source drafts and handing accepted changes to a host publisher."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-source-controller

English | [中文](README.zh.md)

## Summary

Save complete browser file snapshots through one Host API and publish only revisions accepted by the Host. Sandpack, direct DSH Web editors, and other clients can share the same draft protocol. Choose this seam when the Host must enforce paths, revisions, session ownership, and publisher boundaries; it does not store drafts in the memory plugin.

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

### When to choose it

`@deepseek-ai/dsh-api-source-controller` is the shared Host/Client seam for browser source drafts. Sandpack and direct DSH Web use the same Remote API; the Host owns durable draft storage, revision fencing, path limits, and lifecycle checks.

The Client package also exports `SourceDraftModel`, a React-free editor adapter. Feed it complete file snapshots from Sandpack or another editor, call `save()` explicitly, and subscribe to its immutable snapshot for `dirty`, `conflict`, `saved`, and `published` state. `publish()` refuses unsaved local files, so a UI cannot accidentally publish a stale buffer.

`SourceDraftModel` is deliberately not the DSH memory plugin. Draft files and revision state stay in the `source_drafts` storage domain; they are not copied into an MCP memory server, the Session log, prompts, or model-facing tools. Use the optional memory MCP separately for project facts or decisions that should be recalled by the model.

### Minimal configuration

Mount the controller with the storage and Session services that own the draft domain. It has no package-owned credential configuration.

```yaml
- name: '@deepseek-ai/dsh-api-source-controller'
```

```ts
const model = new SourceDraftModel(ctx.sourceDrafts, {
  sessionId,
  baseSha,
  files: sandpackFiles,
})

model.setFiles(nextSandpackFiles)
await model.save()
await model.publish()
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The controller validates and normalizes relative source paths, applies file and byte limits, and stores immutable draft records keyed by Session identity. The Remote client uses the same result vocabulary for bootstrap, save, delete, and publish. Publication is an injected Host seam; without one, the controller returns a typed failure instead of attempting Git or PR work.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Framework-neutral draft model](../../core/source-draft-model/README.md) — editor state and revision fencing.
- [Host GitHub publisher](../../host/source-publisher-github/README.md) — optional host-owned PR creation.
- [Configuration catalog](../../../docs/config-catalog.md) — generated field reference.

-----

## Model Experience

### Browser source drafts

#### What the model sees

Nothing directly. `sourceDrafts` stores browser editing state outside the Session log and does not add a prompt, tool, or model-facing event; an explicitly mounted `SourcePublisher` may later turn an accepted draft into a host-side Git operation.

#### Token effect

Zero for draft operations. File contents, revisions, and publication results are not inserted into model requests by this package.

#### KV Cache effect

Independent. Saving or publishing a browser source draft does not change the model request prefix or invalidate a provider cache entry.

## Known Limitations and Deferred Work

- No runtime invariant companion is published because this controller owns a storage and publication seam but no additional mutable runtime relationship for the invariant registry.
- No Git/PR publisher is mounted by the default web bundle. `publish` therefore returns `publisher-unavailable` until an EC2 or other host deployment composes a dedicated publisher with its own worktree and credential policy. Secrets and repository metadata paths are rejected from browser drafts.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
