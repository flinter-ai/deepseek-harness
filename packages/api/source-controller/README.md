# DSH source controller

`@deepseek-ai/dsh-api-source-controller` is the shared Host/Client seam for browser source drafts. Sandpack and direct DSH Web use the same Remote API; the Host owns durable draft storage, revision fencing, path limits, and lifecycle checks.

The Client package also exports `SourceDraftModel`, a React-free editor adapter. Feed it complete file snapshots from Sandpack or another editor, call `save()` explicitly, and subscribe to its immutable snapshot for `dirty`, `conflict`, `saved`, and `published` state. `publish()` refuses unsaved local files, so a UI cannot accidentally publish a stale buffer.

`SourceDraftModel` is deliberately not the DSH memory plugin. Draft files and
revision state stay in the `source_drafts` storage domain; they are not copied
into an MCP memory server, the Session log, prompts, or model-facing tools.
Use the optional memory MCP separately for project facts or decisions that
should be recalled by the model.

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

## Model Experience

### Browser source drafts

#### What the model sees

Nothing directly. `sourceDrafts` stores browser editing state outside the Session log and does not add a prompt, tool, or model-facing event; an explicitly mounted `SourcePublisher` may later turn an accepted draft into a host-side Git operation.

#### Token effect

Zero for draft operations. File contents, revisions, and publication results are not inserted into model requests by this package.

#### KV Cache effect

Independent. Saving or publishing a browser source draft does not change the model request prefix or invalidate a provider cache entry.

## Known Limitations and Deferred Work

- No Git/PR publisher is mounted by the default web bundle. `publish` therefore returns `publisher-unavailable` until an EC2 or other host deployment composes a dedicated publisher with its own worktree and credential policy. Secrets and repository metadata paths are rejected from browser drafts.
