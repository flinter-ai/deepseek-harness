---
description: "Human-facing Sandpack source editor backed by durable DSH drafts and an explicit Host publication boundary."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-source-editor

The source-editor package adds a session-header action for editing project
files in Sandpack. It is a browser editing and preview surface, not a compute
backend: files are held in a framework-neutral `SourceDraftModel`, saved
through the Host source controller, and published only by an explicitly
configured Host Git/PR publisher.

## Use this package

Mount the plugin in the Web bundle beside
`@deepseek-ai/dsh-api-source-controller`. Opening the action loads the latest
draft for the Session or bootstraps the exact Git `HEAD` base. Save is explicit;
Create PR is disabled while the local buffer is dirty or in conflict. Deleting
the durable draft leaves any local editor changes dirty so they cannot be
silently lost.

The browser never receives Git credentials and Sandpack does not create a PR.
The Host publisher is deployment-owned and fail-closed when no repository
identity is configured.

## Understand the implementation

`SourceDraftModel` serializes saves, fences revisions, and exposes
`idle`/`dirty`/`saving`/`saved`/`conflict`/`published` state without importing
React or Sandpack. `SourceEditorAction` adapts that model to a Sandpack code
editor and preview. Source drafts are not DSH memory-plugin records: the draft
files and revision live in the source-draft store, while the optional memory
MCP remains a separate model-facing facts/decisions layer.

## Model Experience

### Human source editing

#### What the model sees

Nothing directly. The human-facing `SourceDraftModel` editor keeps draft files, revision status, and the resulting Pull Request URL outside prompts, messages, tools, and model-visible session events.

#### Token effect

None; the editor does not assemble or send provider requests.

#### KV Cache effect

None; browser editing and preview do not change the model history or provider cache.

## Known Limitations and Deferred Work

- **Browser editor only** — Sandpack previews and edits files in the browser;
  they do not run the DSH worker or replace EC2/CodeSandbox compute.
- **Explicit Host publication required** — without a deployment-owned GitHub
  publisher, Save works but Create PR fails closed.
- **Conflict reconciliation is surfaced, not auto-merged** — a stale revision
  becomes `conflict` and the human must reload/reconcile before saving again.
- **No provider credential access** — source editing, Sandpack, and the memory
  plugin never receive GitHub or model-provider keys.
