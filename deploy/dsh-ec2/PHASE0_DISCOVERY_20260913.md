# DSH EC2 runtime artifact — Phase 0 discovery

**Checked:** 2026-09-13 (America/New_York)

**Purpose:** redacted, read-only discovery for
`RUNTIME_ARTIFACT_ROLLOUT_PLAN.md`. This record is evidence for planning only;
it is not a deployment authorization and contains no credentials, cookies,
secret values, or process environments.

## Repository role separation

| Role | Current path/ref | Result |
| --- | --- | --- |
| Protected local harness | `/Users/oldap/deepseek-harness` @ `70c1ba3b90b01653d712b2443befe1873a853f8a` | Untouched; existing untracked WIP remains. |
| Official upstream worktree | `/Users/oldap/deepseek-harness/.worktrees/dsh-upstream-core-20260913` @ `c291e7961a515f6d7af9304e7fd1d257929aef26` | Separate upstream source. |
| Archived EC2 source | `/Users/oldap/deepseek-harness/.worktrees/dsh-ec2-merged-20260912` @ `0199028dc6fc0428f8d25f40424d18d9d18fe683` | Preserved source line; not used as a build/deploy source. |
| EC2 upgrade destination | `/Users/oldap/deepseek-harness/.worktrees/dsh-ec2-upstream-reconcile-20260913` on `reconcile/dsh-ec2-upstream-20260913` @ `ae3d4147a9408f590410a985d6de81ea24ce2777` | Current mutation boundary; plan and evidence are untracked here. |

The protected local harness was not switched, merged, cherry-picked, reset,
cleaned, committed, or deployed.

## AWS target discovery

- AWS CLI identity check succeeded through the `flinter` IAM Identity Center
  profile. The raw identity and account details are intentionally not copied
  into this record.
- Region checked: `us-east-2`.
- Candidate DSH host: `flinter-orca-dsh`, instance
  `i-09cc08b3fdad49cf5`.
- Instance type: `t4g.medium`; architecture: `arm64`; platform: Linux/UNIX.
  This confirms the requested size/architecture at the EC2 metadata level.
- State: `stopped`, with a user-initiated shutdown reason.
- Systems Manager: no current managed-instance record was returned, so the
  target is not presently online through SSM.

The following live-host facts remain unverified until the owner starts the
instance and SSM returns `Online`: `uname -m`, OS release, Node/pnpm versions,
RAM/swap/disk, the active service unit, the `/opt/dsh-phase2` layout, current
release state, and the actual profile/credential-provider composition. No
start, stop, SSM command, or deployment was performed.

## CI and artifact-store discovery

- The current worktree has no `.circleci` configuration.
- The checked-in EC2 workflow is
  `.github/workflows/deploy-dsh-ec2.yml`; the destination worktree now
  replaces the former host-build/self-hosted-x64 path with a native Linux
  ARM64 build job plus an SSM activation job. The workflow remains unexercised
  until its protected environment variables, OIDC role, artifact bucket, and
  online EC2/SSM target exist.
- The repository already demonstrates an ARM64 GitHub-hosted runner label
  (`ubuntu-24.04-arm`) in other workflows. Its suitability for this DSH
  runtime artifact still needs a focused build/smoke test.
- No DSH/release artifact bucket was identified by the read-only name scan.
  The existing `flinter-control-plane-vector-store` bucket is not assumed to
  be a runtime artifact store. No bucket, IAM policy, OIDC role, or retention
  policy was created or changed.
- The destination worktree now contains a runtime manifest, immutable release
  pointer, checksum-verified extraction path, and artifact-based EC2 activation
  in `deploy/dsh-ec2/deploy.sh`; the old host `pnpm install`/`build:lib` path is
  no longer used by the new artifact mode. This is source/worktree evidence,
  not a live-host deployment claim.

## Phase 0 verdict

The target architecture is known: **Linux ARM64 on `t4g.medium`**. The P0
implementation can be designed around an ARM64 CI build, but the live-host
and artifact-distribution gates are not yet closed.

### Next authorized in-scope step

1. Decide or verify the account-owned immutable artifact store and its CI/EC2
   read/write authorities; do not create resources implicitly.
2. When the owner starts `i-09cc08b3fdad49cf5` and SSM is `Online`, collect the
   redacted live-host facts above.
3. Run the new builder on native Linux ARM64, publish one versioned artifact,
   and rehearse the checksum/extraction/rollback path before production.

No production release is eligible from this discovery record alone.

## P0 local artifact prototype result

The first implementation of the local artifact path now exists in
`deploy/dsh-ec2/build-runtime-artifact.ts`, with the private composition root
at `packages/deployment/dsh-ec2-runtime`.

- The composition root explicitly brings together `@deepseek-ai/dsh`, the
  Web bundle, alpha/AWS profiles, AWS credential provider, source
  draft/controller/editor, and host GitHub publisher. Missing peer roots for
  Cordis group and Cosmokit are explicit rather than being discovered at
  runtime. The clean archive was checked for all of those package roots.
- A clean production deployment probe produced a 467 MB uncompressed closure.
  After pruning manager metadata, declarations, maps, caches, and symlinks, the
  local macOS arm64 archive was 81 MB compressed after the source package roots
  were made explicit.
- The probe fixed source SHA
  `ae3d4147a9408f590410a985d6de81ea24ce2777`, generated a file-level manifest
  and detached checksum plus a sibling manifest, extracted the archive again,
  verified every file and both manifest copies, and ran the DSH CLI/Web/EC2
  launcher help smoke.
- The local artifact was `darwin/arm64`, not the production target. Its local
  pass proves the packaging protocol and runtime closure only; it is not Linux
  or EC2 deployment evidence. The first production artifact must be built on a
  native Linux ARM64 CI runner and carry `linux/arm64` in its manifest.
- The current alpha profile still makes CodeSandbox part of the closure, so
  this prototype intentionally does not claim the P1 lazy-backend reduction.

The artifact-based deployment script and ARM64 CI workflow now exist in the
destination worktree, but they have not been pushed, published to S3, or run
through SSM. No AWS resource was created and no EC2 service was restarted.
The full `pnpm run build:lib` also passes after the private composition root
adds a no-op tsdown input configuration; the composition root is not treated
as a normal library bundle.
