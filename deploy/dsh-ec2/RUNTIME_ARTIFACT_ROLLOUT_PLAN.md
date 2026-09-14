# DSH EC2 runtime artifact rollout plan

**Status (2026-09-13 America/New_York; last deployment 2026-09-14 UTC):** The
P0 implementation is pushed on draft PR #69 against the isolated upstream
snapshot base at commit
`abbddead9b0a53c31e2e41b673bda21e45d710a4`. Native Linux arm64 CI run
`34791268500` passed immutable install, library build, artifact build, and
artifact verification. The exact archive was independently checksum-checked,
published to the private S3 artifact store, and deployed to the EC2 target by
SSM command `77817d8d-a6ba-419f-b6ab-1fee879df5fb`. EC2 now runs the exact
release with service `active`, localhost `401`, explicit `ec2` compute, and
Secrets Manager provider resolution without credential values in the service
or process environment. The source is still unmerged and PR #69 remains a
draft reconciliation/rollout branch. The authenticated Web E2E now passes; an
induced rollback rehearsal remains the open P0 gate.

**Source baseline:** `reconcile/dsh-ec2-upstream-20260913` at
`abbddead9b0a53c31e2e41b673bda21e45d710a4`, based on the isolated
`upstream/master` snapshot `c291e7961a515f6d7af9304e7fd1d257929aef26`.

**Release record:** The CI archive is
`dsh-ec2-runtime-abbddead9b0a53c31e2e41b673bda21e45d710a4-linux-arm64.tar.gz`
with SHA-256
`24241f5cb51b45a70f42c15ef6c5f28786e612be4d32a61dd26ab3eb39b84ee8`. It is
stored below the private bucket
`flinter-dsh-ec2-artifacts-527947547848-us-east-2/dsh-ec2/`; GitHub environment
variables now point the deployment workflow at that bucket, the `dsh-ec2`
prefix, and the scoped OIDC deploy role.

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
- The local prototype produced a 467 MB uncompressed tree. The artifact also
  carries the profile settings adapter, AWS overlay, and release launcher;
  this is protocol/closure evidence only.
- `.github/workflows/deploy-dsh-ec2.yml` now builds on `ubuntu-24.04-arm`,
  publishes the archive/checksum/manifest under configured S3 variables, and
  passes only the resulting immutable URI to SSM. The protected environment is
  now configured with the bucket/prefix and matching OIDC/EC2 IAM permissions.

The authoritative Linux arm64 artifact from run `34791268500` is 47,632,230
bytes compressed and contains 19,795 manifest-tracked files. Its detached
checksum and manifest source SHA were independently verified locally and again
by the EC2 deployment script before extraction. The CI job's isolated builder
smoke passed; EC2 then reached the redacted service/profile checks from the
same bytes.

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

The artifact path has now been exercised on the EC2 target. SSM command
`77817d8d-a6ba-419f-b6ab-1fee879df5fb` verified the detached archive checksum,
the per-file manifest, the `linux/arm64` target, settings compatibility,
protected ingress, the read-only AWS credential provider, and a stable service
restart. `/opt/dsh-phase2/releases/current` points to the exact source SHA
release. The deployment snapshot is retained at
`/var/lib/dsh-phase2/deploy-backups/20260914T000935Z-0199028dc6fc0428f8d25f40424d18d9d18fe683`.
The public hostname returned `403` without an authenticated session, so this
is ingress reachability/protection evidence rather than authenticated Web E2E.

The redacted authenticated Web E2E was then run against the exact live release
through SSM command `1aac1d4e-7d2f-4bac-8621-85e3370f3c52`: token exchange
returned `303`, authorized `settings/describe` returned `200`, and the same
cookie sent with an untrusted Host returned `403`. No token, cookie, or response
body was recorded.

**Gate:** the new path must prove that EC2 did not invoke package installation
or source compilation, and that rollback returns the previously verified
artifact to service.

### Phase 3 — staged release proof

1. Build a candidate from an exact reviewed GitHub SHA.
2. Activate that exact artifact in the approved staging/rehearsal target.
3. Confirm artifact manifest, checksum, release pointer, service health,
   authenticated Web behavior, profile composition, source publisher
   fail-closed behavior, and redacted Secrets Manager resolution.
4. Promote the identical bytes—not a rebuild—to production through the
   protected deployment environment.
5. Record the source SHA, artifact checksum, target, activation time,
   health evidence, and rollback pointer. This record contains no secrets.

The exact EC2 activation is complete for this reviewed SHA, but production
success is still not claimed: the source PR is not merged and rollback has not
yet been induced and rehearsed. A CI pass or an unauthenticated `401` health
probe is necessary but
not sufficient.

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
