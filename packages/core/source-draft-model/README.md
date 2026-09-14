---
description: "Framework-neutral source draft state machine shared by Sandpack and other editors."
kind: "package-reference"
---

# @deepseek-ai/dsh-source-draft-model

English | [中文](README.zh.md)

## Summary

Keep a browser editor's files and revision state coherent while saves run serially and stale publishes fail safely. Use this framework-neutral model when Sandpack or another editor needs the same draft protocol without importing React, Git, compute, or credentials.

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

This package provides the React-free `SourceDraftModel` used by browser source editors. It serializes saves, fences optimistic revisions, tracks dirty and conflict state, refuses to publish unsaved files, and preserves local dirty files after a durable draft is deleted.

Give the model a `SourceDraftRemote` implementation and a Session/Git base, then adapt `getSnapshot()` and `subscribe()` to any editor framework. Sandpack is one adapter; a direct DSH Web editor or another browser editor can use the same model without importing React, Sandpack, Git, or provider credentials.

The model stores no draft contents in the optional DSH memory MCP. Durable source files and revisions belong to the source-draft service; memory remains a separate model-facing facts and decisions layer.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The model keeps the local file snapshot separate from the remote draft revision. A serialized operation chain prevents overlapping saves, while the remote result decides whether the snapshot becomes saved, conflicted, or published. The model exposes immutable snapshots and leaves storage, Git, and provider authority to its injected remote and Host composition.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Source controller](../../api/source-controller/README.md) — durable Host Remote implementation.
- [Source editor](../../client/ui-source-editor/README.md) — Sandpack browser adapter.
- [Configuration catalog](../../../docs/config-catalog.md) — generated package metadata.

-----

## Model Experience

### Human source editing

#### What the model sees

Nothing directly. `SourceDraftModel` coordinates a human editor buffer and a Host Remote without adding prompts, tools, messages, schemas, or model-visible session events.

#### Token effect

None; the model does not assemble or send provider requests.

#### KV Cache effect

None; editor state changes do not alter model history or provider cache.

## Known Limitations and Deferred Work

- No runtime invariant companion is published because this package is a pure per-editor state machine without a package-owned global runtime relationship.
- **No automatic merge** — a version conflict is surfaced to the editor; the package does not choose between competing file contents.
- **Remote-owned persistence** — the model is an in-memory client state machine; the injected `SourceDraftRemote` must provide durable storage and publication.
- **No credential handling** — GitHub, model-provider, and memory credentials remain outside this package.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
