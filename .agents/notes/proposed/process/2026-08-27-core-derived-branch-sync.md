# Agent Note: Synchronize core into derived DSH branches

Status: proposed

English | [中文](2026-08-27-core-derived-branch-sync.zh.md)

## Problem

The shared DSH integration line is `flinter/core`, while local-harness, dsh-segment, and aws-runtime carry profile or capability-specific changes. Git branch pointers do not inherit later commits, so a shared fix can remain absent from a derived runtime without any visible synchronization record. AWS also combines runtime-specific commits with a segment capability snapshot, so a core update must not conceal an independent dsh-segment drift.

## Proposal

The `Sync core to derived branches` workflow listens for pushes to `flinter/core` and for manual dispatch. It opens or reuses a draft pull request from `flinter/core` into each of these derived branches:

- `flinter/local-harness` for the local DeepSeek profile;
- `flinter/dsh-segment` for the segment-workflow capability line; and
- `flinter/aws-runtime` for the AWS runtime composition.

The workflow never force-pushes or auto-merges. A separate compatibility check compares `flinter/aws-runtime` with `flinter/dsh-segment`, runs a local `git merge-tree` check, and emits a GitHub Actions warning when the segment branch has commits absent from AWS or the two tips have a textual merge conflict. An AWS core-sync pull request repeats history-drift warnings in its body and states that segment capability reconciliation remains separate.

`flinter/dsh-orca-plugin` is not included in this derived-branch list because its current history is not based on the current `flinter/core` line. Its alignment and consumer package updates remain an explicit integration decision.

## Implementation record (2026-08-27)

The workflow is implemented on `flinter/core`. PRs #14, #18, #19, and #23 landed the synchronization workflow, the correct GitHub compare request, App-authenticated PR path, and squash-replay-safe content detection. Target-based repair PRs #27, #28, and #29 restored `flinter/core` as a real second parent of each derived line after the first syncs were squash-merged.

Operational rules:

- Merge a core-sync PR with a normal merge commit, not squash or rebase, so future comparisons retain source ancestry. If a squash replay has already happened, repair from the target branch with a merge commit before the next core sync.
- The detector compares the source compare response's changed paths by target and source tree entry (mode, type, and object SHA), so already-represented content does not reopen a duplicate PR. Missing or truncated tree data fails the job instead of guessing.
- Sync PR creation uses the installed `DSH Issue Management-1` GitHub App. The App must have repository `Pull requests: Read and write`; the current installation was verified with `Pull requests: Write` on 2026-08-27. The repository-wide GITHUB_TOKEN create/approve setting remains disabled.
- AWS/dsh-segment drift is warning evidence only. Core synchronization never includes the separate segment capability integration.

## Alternatives considered

**Rely on branch ancestry.** An ancestor relationship records history but does not move a derived branch when `flinter/core` advances.

**Automatically merge core into every derived branch.** Automatic merges could conceal conflicts in profile-specific or capability-specific code. Draft pull requests keep the delta visible and require the target checks and review.

**Treat AWS as a copy of dsh-segment.** AWS has its own runtime integration changes and consumes capability output; a warning and separate integration change preserve that authority boundary.

**Put segment reconciliation inside the core sync PR.** This mixes shared-base synchronization with capability delivery and makes it unclear whether AWS actually contains the segment line. The workflow reports the drift without combining the changes.

## Acceptance criteria

- A push to `flinter/core` runs the workflow and considers all three derived branches.
- A target behind core receives one reusable draft sync pull request rather than duplicate pull requests.
- A target already containing core produces no unnecessary pull request.
- AWS/dsh-segment commit drift or a textual merge conflict produces a visible workflow warning and, when an AWS sync pull request exists, a history-drift warning in that pull request body.
- The workflow does not auto-merge, force-push, update package pins, or resolve dsh-segment drift.

## Risks

The workflow requires repository permission for `GITHUB_TOKEN` to create pull requests. Pull requests created by that token may require repository-specific Actions settings or a manual check rerun before all downstream pull-request workflows execute. A conflict remains a reviewable synchronization PR, not evidence that the branches are interchangeable.
