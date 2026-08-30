# Agent Note: Node runtime and local failure playbook

Status: implemented

English | [中文](2026-08-29-node-runtime-failure-playbook.zh.md)

## Problem

The workspace was advertised for `^22.19.0 || >=24.0.0`, but one local push used Node `22.16.0`. That runtime is below the supported Node 22 floor and caused the optional `unrun` build dependency to fail before the declared build/typecheck could provide useful evidence. The resulting hook failure looked like a code failure even though the Node executable was the first defect.

## Decision

The repository contract remains `^22.19.0 || >=24.0.0`. Node 25 is a valid local choice, but the repository does not replace its supported matrix with Node 25: CI's primary lane is Node 24 and the compatibility floor remains Node 22.19. The standardized `pre-commit` and `pre-push` hooks now fail fast through [`scripts/verify-node-runtime.mjs`](../../../../scripts/verify-node-runtime.mjs), before TypeScript or optional build dependencies load. The guard reports the active executable so a version-manager or `PATH` mistake can be corrected rather than bypassed.

## Failure classification

| Case | Importance | Hook action | Correct response |
| --- | --- | --- | --- |
| Node below `22.19`, including `22.16` | P0 | Fail immediately | Select Node 24/25+ or Node 22.19+, verify `node -v` and retry |
| Staged lint, whitespace, translation pairing, or vendor manifest drift | P0 | Fix or reject in pre-commit | Apply the safe fix, stage generated output, or correct the staged file |
| TypeScript/build contract errors | P0 | Reject in pre-push | Fix the code or dependency contract; do not bypass the runtime guard |
| Snapshot or expected-output diff | P1 | Do not auto-update | Inspect the semantic diff; update only when the behavior is intentional and reviewed |
| Reproducible unit/E2E failure | P1 | Do not suppress | Fix the regression or record an explicit blocker with evidence |
| Hosted runner queue, provider outage, missing secret, or platform-only failure | P1 | Not a local-hook fix | Classify as CI/environment evidence, rerun only with a reason, and preserve the failure record |
| Unrelated flaky or resource-contention failure | P2 | Do not hide it in hooks | Re-run in isolation, determine reproducibility, and record `NOT_RUN`, `BLOCKED`, or `FAIL` honestly |

## Pull-request check importance

“Non-blocking” means the check must not prevent merging a code change; it does not mean the underlying test may be silently skipped. The check remains visible and is still investigated when it fails.

| Class | Checks | Merge treatment |
| --- | --- | --- |
| Non-blocking / informational | Cloudflare PR preview deployment (permanently skipped; GitHub Pages is the canonical PR preview); real-provider E2E on fork PRs without provider secrets; observational and benchmark jobs | Report the result; do not make it a merge blocker. Do not call a skipped E2E a provider pass. |
| Important / blocking | Node 24 static, coverage, snapshots/artifacts; Node 22.19 and Node 26 compatibility; Windows build/native/coverage; Python contract checks; aggregate verdict | Must pass or have an explicit, reviewed infrastructure exception. Never skip merely because it is slow. |
| Current exception | Windows native test job: four files passed, but the `workflow-worker-thread` Vitest worker exited unexpectedly | Keep blocking until an isolated rerun proves a platform flake or the owner records an explicit policy decision. |
| Local hook scope | Runtime guard, staged lint, whitespace, translation pairing, vendor manifest; pre-push typecheck | Keep cheap deterministic checks in hooks. Do not run full coverage, snapshots, provider E2E, or cloud deployment in local hooks. |

## Standard local sequence

1. Run `node -v` and confirm the executable satisfies the root `engines.node` range.
2. Prefer the same Node 24 line used by the primary CI lane; Node 25 is also valid when it is the intentional local runtime.
3. Run `pnpm install --frozen-lockfile` after changing the runtime or lockfile.
4. Run the narrowest relevant test, then `pnpm run typecheck` before pushing.
5. Treat green local checks as evidence for that runtime only; CI still owns the complete matrix and platform gates.

The hooks intentionally fix cheap deterministic defects and reject contract errors. They do not auto-rewrite snapshots, retry provider/runner failures indefinitely, or declare cloud/scientific evidence from a local pass.

## Consequences

An invalid Node executable is now identified before it can produce misleading `tsx`, `unrun`, TypeScript, or build errors. The guard cannot change the parent shell's `PATH`, so selecting Node is still an explicit developer or CI environment action; the error names the executable and the supported alternatives. Node 25 therefore remains an opt-in local preference, while Node 24 and Node 22.19 remain verifiable supported lanes.

## Alternatives considered

- **Force Node 25 everywhere.** Rejected: Node 25 is valid but is not the repository's LTS floor or CI primary, and forcing it would remove an intentional Node 22.19/24 compatibility contract.
- **Let hooks run on any Node and rely on CI.** Rejected: Node 22.16 fails before meaningful checks and wastes a push while obscuring the cause.
- **Auto-select a machine-specific Node path in the hook.** Rejected: `nvm`, `asdf`, Homebrew, and CI installations differ; a portable guard can identify the wrong runtime, but cannot safely mutate the caller's shell environment.
- **Ignore optional-dependency or provider failures.** Rejected: an optional package load failure is actionable when caused by an unsupported runtime, while provider and hosted-runner failures require separate evidence rather than blanket suppression.
