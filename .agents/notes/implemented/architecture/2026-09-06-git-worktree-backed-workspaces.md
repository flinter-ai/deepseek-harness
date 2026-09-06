# Agent Note: Git worktree-backed DSH workspaces share one handle

Status: implemented

English | [中文](2026-09-06-git-worktree-backed-workspaces.zh.md)

## Problem

Directory grouping gives host consumers a stable path and session account, but a coding session needs a stronger owner: its terminal, editor, skills, code-memory, InstaCloud, and GitHub/PR integrations must all address one isolated checkout instead of independently choosing a shared repository directory.

## Decision

`@deepseek-ai/dsh-workspace` supports both the existing directory-backed record and a Git worktree-backed record. `WorkspaceRegistry.createWorktree()` resolves a source repository and base commit, creates one generated branch and worktree below the configured `worktreeRoot` (defaulting below the resolved DSH home), and persists the repository root, branch, and creation commit beside the canonical workspace path.

Each `Workspace` exposes a frozen `WorkspaceHandle` containing its stable id, canonical path, and optional Git metadata. `handleFor()` and `resolvePath()` let host adapters authenticate the same workspace before resolving an absolute or relative path. `resumeWorktree()` verifies the persisted repository and branch without rewriting dirty files or user commits; registration deletion never removes the worktree.

## Implementation boundary

This slice wires the handle through session create/fork, terminal, local file-reference, and skill adapters. Editor, code-memory, InstaCloud, and GitHub/PR adapters are not present in this checkout and remain `NOT_RUN`; this note does not claim provider, PR, deployment, or live-runtime integration.

The Git adapter uses argv-based `execFile('git', argv)` calls, rejects unsafe revisions and branches, verifies linked-worktree repository identity through Git's common directory, and rolls back only a newly-created clean worktree when registration fails. A process-local serialized lease permits one active session per worktree; session create and fork claim it, and `session/disposed` releases it. Directory-backed workspaces bypass the lease path.

## Alternatives considered

**Keep using one shared repository directory.** This preserves the old path grouping but lets concurrent coding sessions mutate the same checkout and makes adapter-level ownership impossible to verify.

**Create a second workspace registry for worktrees.** This duplicates durable order, session membership, storage recovery, and host wiring. Extending the existing registry keeps directory compatibility and gives both forms one identity owner.

**Shell out through interpolated Git commands.** Shell parsing would make repository paths, branches, and revisions subject to quoting and injection errors. The adapter passes every value as a separate argv element.

**Force-remove worktrees during ordinary deletion or recovery.** Deletion is a registration operation, and recovery cannot prove that an on-disk worktree is still disposable. Only the create operation's own clean worktree is eligible for rollback; user worktrees remain intact.

## Consequences

Host integrations can carry one immutable handle through workspace-aware operations, while existing directory-only callers retain their current behavior. `resolvePath()` enforces lexical containment and supports paths that do not exist yet; an adapter that follows existing symlinks must apply its own canonical-target policy. A worktree's branch and path are isolated per workspace, but process-local leasing intentionally does not coordinate independent DSH processes; a future cross-process lease must use a separate durable ownership mechanism. An interrupted create may leave an unregistered Git worktree for manual cleanup rather than risking user data loss.

The workspace package gains a filesystem and Git dependency and a configurable worktree root. Git/provider/deployment behavior remains local-only in this package; no cloud checkout, PR, or live runtime proof is implied by the workspace handle.
