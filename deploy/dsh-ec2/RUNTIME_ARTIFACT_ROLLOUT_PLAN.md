# DSH EC2 runtime artifact rollout plan

**Status (2026-09-13):** The local P0 implementation and its macOS arm64
rehearsal pass. Destination commit `efd48a1db2c3e147dc10148c680c61c009da7bd8`
is pushed on draft PR #69 against the isolated upstream snapshot base; DSH and
vendor release gates pass, while the unrelated Cloudflare/issue-policy checks
still lack repository configuration and the long-session browser benchmark
failed on its existing frame/replay fixture. A final local artifact for this
SHA has a verified detached checksum and contains the workspace git-worktree
runtime export. Native Linux arm64 CI artifact publication, the account-owned
artifact store, and live EC2 activation remain pending; no production artifact
has been published and nothing has been merged or deployed.

**Source baseline:** `reconcile/dsh-ec2-upstream-20260913` at
`efd48a1db2c3e147dc10148c680c61c009da7bd8`, based on the isolated
`upstream/master` snapshot `c291e7961a515f6d7af9304e7fd1d257929aef26`.

## Objective

Make the CI-built, immutable runtime artifact the only input that production
EC2 executes. The EC2 host must download, verify, extract, atomically activate,
and roll back an exact artifact. It must not run `pnpm install` or
`pnpm run build:lib` during a production release.

This is the first delivery milestone for the upstream-reconciled DSH Web
runtime. It keeps the current host-owned source publisher and optional compute
backends, while separating build work from the small EC2 host.

## Boundaries and ownership

| Concern | Owner | Rule |
| --- | --- | --- |
| Protected local harness | `/Users/oldap/deepseek-harness` | Read-only. Never use it as a build or deployment source. |
| Development source | A dedicated, clean upstream reconcile worktree | Changes are reviewed on a normal topic branch and PR. |
| Source of truth | GitHub | A commit SHA identifies source; a merged PR does not itself deploy. |
| Build and attestation | CI on the EC2-compatible architecture | CI builds the artifact and records SHA, architecture, checksums, and test results. |
| Artifact distribution | Versioned artifact store, selected during Phase 0 | EC2 receives only the immutable release artifact and manifest. |
| DSH Web host | EC2 | Extracts/releases artifacts and owns credentials, settings, service lifecycle, and Git publishing. |
| Compute backend | `ec2` by default; `codesandbox` optional | Backend selection is runtime configuration, not a different DSH deployment or Git branch. |
| Git writes | Host source publisher | Sandpack and CodeSandbox never receive GitHub credentials or push directly. |

The target flow is:

```text
Codex or browser editor
  -> source draft/controller -> host Git publisher -> GitHub branch/PR
  -> CI builds + attests exact SHA -> immutable artifact store
  -> EC2 verifies + activates exact artifact -> DSH Web host
                                         -> EC2 worker or optional CodeSandbox worker
```

`DSH_COMPUTE_BACKEND=ec2` remains explicit in the production systemd drop-in.
The developer-friendly default of `codesandbox` is not a production override.

## Why this is P0

The current `deploy.sh` checks out a Git revision on the host, runs a frozen
workspace install, then runs the full library build. On a small EC2 instance,
that makes releases dependent on host RAM, CPU, package-registry availability,
lockfile tooling, lifecycle scripts, and a broad development dependency graph.
An immutable artifact moves that variable work to CI, shortens service
downtime, gives each release a verifiable identity, and makes rollback a
pointer change rather than another build.

## P0: CI artifact and EC2 activation

### Phase 0 — read-only deployment discovery

Before implementing scripts or changing AWS resources, record redacted facts
from the actual EC2 host and CI configuration:

1. Confirm the target architecture with `uname -m`, OS release, Node and pnpm
   versions, service unit, `/opt/dsh-phase2` layout, persistent DSH home, and
   available disk/RAM. Do not assume x86_64 or arm64.
2. Confirm the release access path: CI identity, EC2 instance role, SSM target,
   and an approved versioned artifact location. Prefer existing account-owned
   storage; do not create long-lived credentials.
3. Identify exactly which generated files and production dependencies are
   required to start DSH Web with the alpha profile, AWS credential provider,
   source controller/editor, and host Git publisher.
4. Verify which state must remain outside a release: settings, profile state,
   Cloudflare credential, systemd unit/drop-ins, service data, and deployment
   backups.
5. Write a short redacted evidence record with the discovered target
   architecture, artifact location decision, and release/rollback paths.

**Gate:** no Phase 1 code until the build architecture and artifact-store
authority are known. Secrets, cookies, AWS values, and GitHub tokens are never
included in the record or artifact.

### Phase 1 — build a minimal, self-describing release artifact in CI

Implement a dedicated artifact builder rather than copying `node_modules` by
hand. It must derive its runtime closure from the package manager and explicitly
stage only what the host needs:

The first implementation boundary is now explicit:

- `packages/deployment/dsh-ec2-runtime` is a private dependency-only
  composition root for the DSH CLI/Web, alpha profile, AWS worker profile,
  AWS credential provider, source draft/controller/editor, and host GitHub
  publisher. The source packages are direct roots so an upstream Web-bundle
  dependency change cannot silently remove this release contract.
- `deploy/dsh-ec2/build-runtime-artifact.ts` runs the production deploy,
  materializes the dependency tree, removes package-manager metadata and
  non-runtime TypeScript artifacts, writes the embedded and sibling file
  manifest/checksums, and verifies a clean extraction plus CLI/Web/launcher
  smoke.
- The local prototype produced a 467 MB uncompressed tree and a compressed
  macOS arm64 archive in the roughly 70–80 MB range after the explicit source
  package roots were added. The artifact also carries the profile settings
  adapter, AWS overlay, and release launcher; this is protocol/closure evidence
  only, and CI must produce the authoritative Linux arm64 artifact.
- `.github/workflows/deploy-dsh-ec2.yml` now builds on `ubuntu-24.04-arm`,
  publishes the archive/checksum/manifest under configured S3 variables, and
  passes only the resulting immutable URI to SSM. It fails closed until those
  bucket/prefix variables and the matching CI/EC2 IAM permissions exist.

The current local macOS arm64 rehearsal produced an 81 MB compressed archive
with 20,852 manifest-tracked files. Its detached checksum and sibling manifest
match the embedded manifest. `pnpm run build:lib`, the artifact builder,
clean extraction, CLI/Web/launcher help, and static/package gates pass. This is
not Linux ARM64 or EC2 proof; the authoritative artifact still must be built
on `ubuntu-24.04-arm`.

- compiled CLI and DSH Web runtime/client assets;
- alpha profile, AWS credential provider, source draft/controller/editor, and
  host GitHub publisher packages (explicitly checked in the composition root
  and builder closure assertions);
- production-only dependency closure and runtime launch files;
- `artifact-manifest.json` containing source SHA, target
  architecture, Node/pnpm/runtime compatibility, file list, and checksums;
- a top-level SHA-256 checksum for the archive and a detached checksum file.

It must exclude TypeScript source where it is not needed at runtime, tests,
Vitest, tsdown, CircleCI tooling, desktop packages, unrelated providers, and
development dependency caches. The exact package closure is validated by a
clean extraction/start test; it is not guessed from directory sizes.

Add a CI job that:

1. checks out the requested immutable source SHA;
2. runs the existing relevant test and build gates;
3. builds the release on the confirmed EC2-compatible architecture;
4. runs an isolated artifact smoke test without workspace install or build;
5. writes the manifest/checksums and publishes only a versioned key such as
   `<source-sha>/<target-arch>/...` after all checks pass;
6. retains CI logs and artifact metadata needed to reproduce the release.

**Gate:** a release artifact is eligible only if its manifest SHA equals the CI
checkout SHA, all checksums verify, and the isolated launch reaches the same
redacted DSH Web/profile checks as the current host path.

### Phase 2 — make activation atomic and reversible

Replace the production build portion of `deploy.sh` only after Phase 1 passes.
The resulting host deployment contract is:

1. SSM receives a source SHA and resolved artifact identifier; it verifies the
   artifact's source SHA and target architecture before stopping DSH.
2. The host downloads to a temporary directory, verifies the detached SHA-256
   checksum and manifest, and extracts to `/opt/dsh-phase2/releases/<source-sha>`.
3. Persistent state remains outside that directory. Settings compatibility,
   profile state, service units, Cloudflare credential, and backups are never
   unpacked from a release artifact.
4. The host atomically changes `/opt/dsh-phase2/releases/current` to the verified
   release, then restarts `dsh.service` from that stable pointer.
5. It runs existing redacted checks: service active/listening, unauthenticated
   root returns `401`, stable ingress contract, AWS credential-provider
   configuration, and absence of credential-shaped service environment values.
6. On any post-switch failure it restores the previous `current` pointer and
   profile/settings snapshot, restarts the prior release, and records a
   timestamped redacted rollback record.

The Git checkout remains only as a read-only deployment metadata and protected
ingress source until the artifact path has passed staging and production
acceptance. It is not the runtime release and is never rebuilt on the host.

**Gate:** the new path must prove that EC2 did not invoke package installation
or source compilation, and that rollback returns the previously verified
artifact to service.

### Phase 3 — staged release proof

1. Build a candidate from an exact merged GitHub SHA.
2. Activate that exact artifact in the approved staging/rehearsal target.
3. Confirm artifact manifest, checksum, release pointer, service health,
   authenticated Web behavior, profile composition, source publisher
   fail-closed behavior, and redacted Secrets Manager resolution.
4. Promote the identical bytes—not a rebuild—to production through the
   protected deployment environment.
5. Record the source SHA, artifact checksum, target, activation time,
   health evidence, and rollback pointer. This record contains no secrets.

Production success is a successful host activation and authenticated E2E
evidence on the exact artifact SHA. A CI pass or an unauthenticated `401`
health probe is necessary but not sufficient.

## Deferred work

### P1 — make CodeSandbox a lazy optional compute package

After P0 is stable, move the CodeSandbox SDK/backend behind an optional package
or lazy import. The EC2 artifact for `DSH_COMPUTE_BACKEND=ec2` must then omit
the SDK entirely. This is a size/isolation optimization; it must not change the
host-owned publisher boundary or block P0.

### P2 — separate remote Codex development service

After artifact deployment is reliable, provision a separate development
checkout/service (for example `/opt/dsh-dev`) with its own branch, port,
systemd unit, access route, and SSM/SSH workflow. Codex edits only that
development checkout. Production remains an artifact release under
`/opt/dsh-phase2/releases` and is changed only through GitHub, CI, and deployment.

## Acceptance matrix

| Claim | Required evidence |
| --- | --- |
| Artifact is source-identifiable | manifest source SHA equals CI checkout and deployment request |
| Artifact is intact | detached archive checksum and per-file manifest checks pass on CI and EC2 |
| Artifact can start independently | clean extraction test runs without `pnpm install` or `build:lib` |
| EC2 deploy is atomic | release directory is immutable; `current` changes only after verification |
| Rollback works | prior pointer restart succeeds after an induced post-switch failure in rehearsal |
| No credential regression | service/process environments remain free of credential values; provider resolves through its approved host authority |
| Web remains protected | listener, `401`, trusted-host/ingress, and authenticated Web checks pass |
| Source publishing boundary remains intact | host publisher alone owns Git token/worktree/commit/push/PR operations |
| CodeSandbox remains optional | production `ec2` selection works without any CodeSandbox credential or SDK requirement |

## Branch and release hygiene

- Work only in a dedicated clean reconciliation/topic worktree based on the
  confirmed integration tip; never mutate `/Users/oldap/deepseek-harness`.
- Keep implementation commits separately reviewable: artifact builder/CI,
  activation script, and documentation/evidence record may be separate PRs.
- Before opening a PR, rebase or merge the current integration tip according to
  repository policy, run focused checks plus artifact smoke validation, and
  review the exact diff.
- Do not push, merge, deploy, prune worktrees, delete branches, or rotate
  credentials merely by executing this plan. Each has its own authorization
  and evidence gate.
- Preserve legacy deployment source and release evidence until Phase 3 proves
  the artifact route. Cleanup is a later explicit reconciliation task.

## P0 definition of done

P0 is complete only when a merged source SHA has one CI-built, checksum-verified
artifact; EC2 activates that exact artifact without installing/building source;
the Web/profile/credential/ingress checks pass; an authenticated E2E succeeds;
and rollback to the previous verified artifact has been rehearsed. CodeSandbox
modularization and remote Codex development are intentionally not P0 exit
criteria.
