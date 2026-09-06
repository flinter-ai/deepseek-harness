# Workspaces

English | [中文](workspace.zh.md)

A workspace is the persistent project record for a directory the user works in: a stable id over a canonical path, a display title, and the ordered account of sessions that belong to it. A coding project can own one Git worktree and exposes one immutable handle for every workspace-aware host adapter. The subsystem is one package ([dsh-workspace](../../packages/workspace/workspace), `ctx.workspaceRegistry`) — an optional host-side capability, not part of the agent-loop spine, and invisible to models (no tools, no prompt text, no session events). It stores its records through the [storage domain form](storage.md) and validates session membership against [`SessionHeader.cwd`](persistence.md#sessionheader--metadata-beside-the-log), so `storageDomain` and `sessionPersistence` are mandatory startup dependencies: an unavailable persistence peer leaves the plugin pending rather than being mistaken for an empty history. Design record: [domain KV storage Agent Note](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md); bootstrap and GUI ordering: [Workspace UI product-flow Agent Note](../../.agents/notes/implemented/feature/2026-07-25-workspace-ui-product-flow.md).

Source: [`packages/workspace/workspace/src/types.ts`](../../packages/workspace/workspace/src/types.ts)

## Identity

```ts type-equiv
/**
 * Identifies one workspace record. A generated uuid, never the path: path
 * normalization rewrites paths, and a reference anchor must stay stable.
 */
type WorkspaceId = Branded<'WorkspaceId'>
```

`WorkspaceId` is a [branded id](core.md#branded-ids). Path identity is separate: `realpathNormalize` (`fs.realpath`; trailing slashes, `..`, and symlinks resolved) is the one uniqueness canon — workspace paths are stored canonicalized, uniqueness is string equality of canonical paths (a symlink to an owned directory collides), and attach-time session cwd checks go through the same canon.

## Project and worktree identity

The workspace record is the project owner for repository-backed sessions. `createWorktree()` creates one generated branch and worktree from a source repository and base commit; host adapters carry the returned handle instead of selecting another checkout from process cwd. Directory-backed workspaces remain valid compatibility records.

```ts type-equiv
/** Git metadata that makes a workspace's directory a first-class worktree. */
interface WorkspaceWorktreeRecord {
  /** Canonical root of the source Git repository. */
  readonly repositoryRoot: string

  /** Branch checked out by this workspace's worktree. */
  readonly branch: string

  /** Commit used as the worktree's creation base. */
  readonly commit: string
}
```

```ts type-equiv
/** Stable, immutable identity passed between host-side workspace adapters. */
interface WorkspaceHandle {
  /** Stable workspace record id. */
  readonly id: WorkspaceId

  /** Canonical directory owned by the workspace. */
  readonly path: string

  /** Git metadata when the directory is a managed worktree. */
  readonly worktree?: WorkspaceWorktreeRecord
}
```

## The workspace entity

Consumers see only the `Workspace` interface; the implementation stays package-private.

```ts type-equiv
/**
 * One workspace: a stable id over an existing directory, a display title, and
 * an ordered candidate account of sessions. Membership requires both an id in
 * that account and a session header whose canonical cwd equals the workspace
 * path. Consumers only see this interface; the implementation stays private.
 */
interface Workspace {
  /** Stable record id (generated uuid). */
  readonly id: WorkspaceId

  /** Immutable identity shared by host-side workspace adapters. */
  readonly handle: WorkspaceHandle

  /**
   * Canonical directory path: the `fs.realpath` of the path given at create
   * time (trailing slashes, `..`, and symlinks all resolved). Never rewritten
   * afterwards, even when the directory disappears (see {@link status}).
   */
  readonly path: string

  /** Git metadata when this workspace owns a managed worktree. */
  readonly worktree: WorkspaceWorktreeRecord | undefined

  /** Display title. Defaults to `basename(path)` at create; duplicates are allowed. */
  readonly title: string

  /** ISO-8601 creation instant, stamped at create and never rewritten. */
  readonly createdAt: string

  /** ISO-8601 instant of the last durable mutation (create counts as one). */
  readonly updatedAt: string

  /**
   * Header-validated sessions in manually owned order: a new session is
   * prepended at attach, explicit reordering goes through
   * `insertSessionBefore`, and activity never reorders. The durable candidate
   * account is filtered synchronously: missing headers, invalid cwd values,
   * and canonical cwd mismatches are never returned. A subsequent workspace
   * mutation prunes those filtered candidates durably.
   */
  readonly sessionIds: readonly SessionId[]

  /**
   * Replace the display title durably.
   * @param title - New title; any string, duplicates across workspaces allowed.
   * @returns resolution after durability.
   */
  setTitle(title: string): Promise<void>

  /**
   * Prepend a session to this workspace's candidate account. An already
   * accounted id resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs. A new id's
   * live or persisted
   * header cwd must resolve to an existing directory equal to {@link path};
   * unknown ids, missing or invalid cwd values, and mismatches reject without
   * writing.
   * @param sessionId - The session to record.
   * @returns resolution after durability.
   */
  attachSession(sessionId: SessionId): Promise<void>

  /**
   * Move an accounted session within the manual order, DOM-insertBefore-like:
   * with an anchor the session lands before it, without one it appends to the
   * end. Only the moved id changes position. A session or anchor absent from
   * the account rejects without writing; a move to the current position
   * resolves without writing, aside from the durable filtered-candidate
   * prune every accepted mutation performs; decided on the domain write
   * chain.
   * @param sessionId - The accounted session to move.
   * @param beforeSessionId - Accounted anchor to insert before; omitted appends.
   * @returns resolution after durability.
   */
  insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void>

  /**
   * Remove a session from this workspace's account. Idempotent: an id not on
   * the account resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs; decided on
   * the domain write chain like attach. Never touches the session's own stored log.
   * @param sessionId - The session to remove.
   * @returns resolution after durability.
   */
  detachSession(sessionId: SessionId): Promise<void>

  /**
   * Live directory check, uncached: whether {@link path} currently exists and
   * is a directory. A missing directory never mutates the record — the
   * directory may only be temporarily moved.
   * @returns `'ok'` when the directory exists, `'missing-dir'` otherwise.
   */
  status(): Promise<'ok' | 'missing-dir'>
}
```

Ownership truth is the record's ordered `sessionIds`, never derived from session cwd — but membership requires both: an id on the account and a header whose canonical cwd equals the workspace path, so one session structurally belongs to at most one workspace. Failed writes reject (`insertSessionBefore` account errors as `WorkspaceMoveInvalidError`, storage failures as plain errors); every accepted mutation stamps `updatedAt` and durably prunes candidates that no longer pass the membership check.

## The registry: `ctx.workspaceRegistry`

`WorkspaceRegistry` ([signatures](#ctxworkspaceregistry--workspaceregistry)) owns registration and resolution. `create(path, title?)` canonicalizes the path, rejects a nonexistent path (the original `ENOENT`) or a non-directory, returns the existing entity unchanged when the canonical path is already owned, and otherwise creates a record with `title ?? basename(path)` prepended to the durable registry order (different canonical paths may share a display title). `createWorktree(options)` resolves a source repository and base commit, creates one generated branch and worktree below `worktreeRoot`, and persists its repository root, branch, and creation commit. `resumeWorktree(id)` verifies that persisted Git identity without rewriting dirty files or user commits. `get(id)` and the ordered `list()` are synchronous cache reads; `handleFor(id)` returns the immutable project handle; `resolvePath(handle, path?)` authenticates that handle and returns a lexically contained path; `resolveByPath(path)` applies the same realpath canon without creating. `claimSession(handle, sessionId)` and `releaseSession(sessionId)` enforce a process-local single-session lease for worktree-backed records; directory-backed records bypass the lease. `delete(id)` removes only the registration, order entry, and session account — the directory, user files, live sessions, persisted logs, and managed worktree are never touched, so those sessions become Ungrouped ([decision](../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.md)); unknown ids return `false`. Create and delete persist a pending-mutation marker before their two writes (record + order) can diverge; startup resolves exactly the marked mutation — by deleting the marked table row, which completes an interrupted delete and rolls back an interrupted create (the registration is re-creatable, so rollback is the safe direction) — and an unmarked order/table mismatch fails loud as corruption.

Sessions get their cwd at create time from whoever creates them, not from this registry — the API gateway resolves a new session's cwd from the chosen workspace's `path` (falling back to an explicit or default cwd), creates the session so the cwd lands in its immutable [`SessionHeader`](persistence.md#sessionheader--metadata-beside-the-log), then calls `attachSession`, which re-validates that stored header cwd against the workspace path. For a worktree workspace, the session controller claims the handle's lease before creation and releases it on creation failure or `session/disposed`. On the first successful start, the registry bootstraps history from persisted headers alone (`id`, `cwd`, `createdAt` — never event bodies), grouping sessions with a valid canonical cwd into per-directory workspaces, newest first; the initialized marker is written last so an interrupted bootstrap resumes safely. The bootstrap is one-time: cwd-less legacy sessions stay Ungrouped, and sessions created afterwards join a workspace only through `attachSession`.

## Consumers

[`dsh-workspace-controller`](../../packages/api/workspace-controller) serves workspace CRUD to GUI clients over `ctx.workspaceRegistry`, and [`dsh-session-controller`](../../packages/api/session-controller) performs the create-session-then-attach flow above and claims worktree leases. This slice wires the shared handle through the session controller, terminal, local file-reference, and skill adapters. Editor, code-memory, InstaCloud, and GitHub/PR adapters are not present in this checkout and remain `NOT_RUN`; when added, they must receive the same `WorkspaceHandle` and use `resolvePath()` rather than infer a separate checkout. [dsh-agent-instructions](../../packages/context/agent-instructions) is **not** a consumer despite the name: it discovers AGENTS.md-style instruction files under an agent's own cwd and never touches `ctx.workspaceRegistry` — the shared word refers to the user's working directory, not to this registry's entities.

The [Git worktree-backed workspace Agent Note](../../.agents/notes/implemented/architecture/2026-09-06-git-worktree-backed-workspaces.md) records the shared immutable handle, process-local worktree lease, and conservative worktree cleanup decision.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdirectorypicker--directorypicker-abstract-seam"></a>

### `ctx.directoryPicker` — `DirectoryPicker` (abstract seam)

Abstract directory-picking service. Subclass, implement `capability()`, and load the subclass as a plugin — it registers as `ctx.directoryPicker` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior). The capability object must be stable for the service lifetime: consumers may capture it across calls.

```ts cordis-catalog
/**
 * The backend's interaction capability.
 * @returns the discriminated capability consumers switch on.
 */
abstract capability(): DirectoryPickerCapability
```

Source: [`packages/host/directory-picker/src/index.ts`](../../packages/host/directory-picker/src/index.ts)

<a id="ctxdirectorypickercontroller--directorypickercontroller"></a>

### `ctx.directoryPickerController` — `DirectoryPickerController`

Host service backing the generated `ctx.remote.directoryPicker` namespace. The seam it exports is abstract and therefore never a Loader entry of its own, so this controller carries the wire verbs: one composed backend serves either the native chooser or the browse primitives, and a verb the composition cannot serve is refused rather than approximated.

```ts cordis-catalog
/**
 * Open the host's OS chooser for a Remote caller.
 * @param signal - caller lifetime; abort terminates the chooser.
 * @returns the chosen absolute path, or null when the operator cancels.
 */
@Remote('pick') async pick(signal: AbortSignal): Promise<string | null>

/**
 * List one directory level for a Remote caller's in-app browser.
 * @param path - absolute directory to list; absent lists the home directory.
 * @param signal - caller lifetime; abort stops the backend's scan instead of
 *   letting it outlive a disconnected caller.
 * @returns the level's listing with its ancestry.
 */
@Remote('list') async list(path: string | undefined, signal: AbortSignal): Promise<DirectoryListing>

/**
 * Create one child directory for a Remote caller's in-app browser.
 * @param path - absolute existing parent directory.
 * @param name - single non-blank path segment.
 * @returns the created directory's absolute path.
 */
@Remote('createDirectory') async createDirectory(path: string, name: string): Promise<string>
```

Source: [`packages/api/workspace-controller/src/directory-picker.ts`](../../packages/api/workspace-controller/src/directory-picker.ts)

<a id="ctxworkspacecontroller--workspacecontroller"></a>

### `ctx.workspaceController` — `WorkspaceController`

Host service backing the generated `ctx.remote.workspace` namespace.

```ts cordis-catalog
/**
 * Create or idempotently resolve one Workspace over an existing directory.
 * @param request - directory path to register.
 * @returns the Workspace and whether this call created it.
 */
@Remote('create') create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue>

/**
 * Rename one Workspace to a unique non-blank title.
 * @param request - Workspace identity and proposed title.
 * @returns the updated Workspace projection.
 */
@Remote('rename') rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue>

/**
 * Remove one Workspace registration while retaining files and Sessions.
 * @param request - Workspace identity to remove.
 * @returns deletion confirmation.
 */
@Remote('delete') delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue>

/**
 * Move one Workspace within the registry display order.
 * @param request - moved Workspace and optional anchor.
 * @returns the complete resulting Workspace order.
 */
@Remote('insertBefore') insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue>

/**
 * Move one accounted Session within a Workspace.
 * @param request - Workspace, Session, and optional anchor identities.
 * @returns the updated Workspace projection.
 */
@Remote('insertSessionBefore') insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<WorkspaceValue>

/**
 * Hide one known Session from Workspace grouping surfaces.
 * @param request - Session identity to archive.
 * @returns the complete resulting archive set.
 */
@Remote('archiveSession') archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue>

/**
 * Stream a complete Workspace baseline followed by ordered increments.
 * @param signal - generation cancellation.
 * @returns baseline followed by ordered Workspace increments.
 */
@Remote({ mode: 'stream' }) follow(signal: AbortSignal): AsyncIterable<WorkspaceFollowFrame>
```

Source: [`packages/api/workspace-controller/src/index.ts`](../../packages/api/workspace-controller/src/index.ts)

<a id="ctxworkspaceregistry--workspaceregistry"></a>

### `ctx.workspaceRegistry` — `WorkspaceRegistry`

Durable workspace registry. Startup waits for `sessionPersistence`, builds one canonical-cwd header index, and completes the one-time history bootstrap before the service becomes active. The persistence dependency is mandatory so an unavailable peer can never be mistaken for an empty history and commit the initialized marker.

```ts cordis-catalog
/**
 * Create or reuse a workspace for an existing directory. The path is
 * canonicalized through `fs.realpath`; a nonexistent path rejects with the
 * original error and a non-directory rejects. Repeated calls for the same
 * canonical path return the existing entity without changing its title.
 * A newly created workspace is prepended to the durable registry order.
 * Different canonical paths may share a display title.
 * @param path - Existing directory to own, in any path spelling.
 * @param title - Display title used only when a new record is created.
 * @returns the existing or newly durable workspace.
 */
async create(path: string, title?: string): Promise<Workspace>

/**
 * Create a new branch-backed Git worktree and register it as one workspace.
 * The worktree is created before its durable record; a failed registry write
 * removes only this newly-created, clean worktree.
 *
 * @param options - Source repository, optional base revision, branch, and title.
 * @returns the newly durable worktree workspace.
 */
async createWorktree(options: CreateWorktreeOptions): Promise<Workspace>

/**
 * Verify and resume a persisted Git worktree workspace without changing it.
 * Dirty files and user-created commits are intentionally preserved.
 *
 * @param id - Persisted worktree workspace id.
 * @returns the verified workspace.
 */
async resumeWorktree(id: WorkspaceId): Promise<Workspace>

/**
 * Look up a workspace by id.
 * @param id - Workspace id.
 * @returns the workspace, or `undefined` when unknown.
 */
get(id: WorkspaceId): Workspace | undefined

/**
 * Return the immutable adapter handle for a workspace.
 * @param id - Workspace id.
 * @returns the stable handle, or `undefined` when unknown.
 */
handleFor(id: WorkspaceId): WorkspaceHandle | undefined

/**
 * Resolve a path under an authenticated workspace handle.
 *
 * @param handle - Handle previously returned by this registry.
 * @param path - Absolute or workspace-relative path; defaults to the root.
 * @returns a lexically contained absolute path.
 */
resolvePath(handle: WorkspaceHandle, path: string = '.'): string

/**
 * Return the worktree handle that currently accounts for a session.
 * @param sessionId - Session id to locate.
 * @returns the owning worktree handle, or `undefined`.
 */
worktreeForSession(sessionId: SessionId): WorkspaceHandle | undefined

/**
 * Claim the one active-session lease for a worktree.
 *
 * @param handle - Worktree workspace handle to claim.
 * @param sessionId - Session that will operate in the worktree.
 */
claimSession(handle: WorkspaceHandle, sessionId: SessionId): Promise<void>

/**
 * Release every worktree lease held by a disposed session. Idempotent.
 * @param sessionId - Session whose lease is ending.
 */
releaseSession(sessionId: SessionId): Promise<void>

/**
 * Synchronous workspace projection in durable registry order. Every
 * entity's `sessionIds` getter is already filtered by the startup/live
 * canonical-cwd header index; this method performs no persistence reads.
 * @returns a fresh ordered array of workspace entities.
 */
list(): Workspace[]

/**
 * Delete one workspace registration while retaining its directory and every
 * session log. The durable order is updated before the table deletion; a
 * failed table write restores the prior order and keeps the entity
 * published. Unknown ids are an idempotent no-op for domain callers.
 * @param id - Workspace registration to remove.
 * @returns `true` when a record was deleted, `false` when it was unknown.
 */
delete(id: WorkspaceId): Promise<boolean>

/**
 * Move one workspace within the durable display order, DOM-insertBefore-like.
 * With an anchor it lands before that workspace; without one it appends.
 * @param id - Workspace to move.
 * @param beforeId - Workspace anchor; omitted appends.
 * @returns the complete committed workspace order.
 */
insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]>

/**
 * Archive one session durably. The session must exist (live or in session
 * persistence); its workspace accounting — or lack of one — is irrelevant.
 * An already archived id resolves without writing.
 * @param sessionId - The session to archive.
 * @returns resolution after durability.
 */
archiveSession(sessionId: SessionId): Promise<void>

/**
 * Resolve by canonical directory path without creating or mutating a
 * workspace. A missing path rejects during `realpath`; an existing unowned
 * directory returns `undefined`.
 * @param path - Existing directory path in any spelling.
 * @returns the workspace owning the canonical path, when one exists.
 */
async resolveByPath(path: string): Promise<Workspace | undefined>
```

Types: [SessionId](core.md)

Source: [`packages/workspace/workspace/src/index.ts`](../../packages/workspace/workspace/src/index.ts)
<!-- END GENERATED cordis-surface -->
