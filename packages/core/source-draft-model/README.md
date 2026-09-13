---
description: "Framework-neutral source draft state machine shared by Sandpack and other editors."
kind: "package-reference"
---

# @deepseek-ai/dsh-source-draft-model

This package provides the React-free `SourceDraftModel` used by browser source
editors. It serializes saves, fences optimistic revisions, tracks dirty and
conflict state, refuses to publish unsaved files, and preserves local dirty
files after a durable draft is deleted.

## Use this package

Give the model a `SourceDraftRemote` implementation and a Session/Git base, then
adapt `getSnapshot()` and `subscribe()` to any editor framework. Sandpack is one
adapter; a direct DSH Web editor or another browser editor can use the same
model without importing React, Sandpack, Git, or provider credentials.

The model stores no draft contents in the optional DSH memory MCP. Durable
source files and revisions belong to the source-draft service; memory remains a
separate model-facing facts and decisions layer.

## Model Experience

### Human source editing

#### What the model sees

Nothing directly. `SourceDraftModel` coordinates a human editor buffer and a Host Remote without adding prompts, tools, messages, schemas, or model-visible session events.

#### Token effect

None; the model does not assemble or send provider requests.

#### KV Cache effect

None; editor state changes do not alter model history or provider cache.

## Known Limitations and Deferred Work

- **No automatic merge** — a version conflict is surfaced to the editor; the
  package does not choose between competing file contents.
- **Remote-owned persistence** — the model is an in-memory client state machine;
  the injected `SourceDraftRemote` must provide durable storage and publication.
- **No credential handling** — GitHub, model-provider, and memory credentials
  remain outside this package.
