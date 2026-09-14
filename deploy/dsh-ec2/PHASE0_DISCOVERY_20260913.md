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
| EC2 upgrade destination | `/Users/oldap/deepseek-harness/.worktrees/dsh-ec2-upstream-reconcile-20260913` on `reconcile/dsh-ec2-upstream-20260913` @ `abbddead9b0a53c31e2e41b673bda21e45d710a4` | Current mutation boundary; clean, pushed to draft PR #69, and used to build/deploy the exact artifact. |

The protected local harness was not switched, merged, cherry-picked, reset,
cleaned, committed, or deployed.

The official upstream repository is the source baseline. The FLINTER fork is
used only for the downstream review and release branches in this work:

- `reconcile/dsh-upstream-base-20260913` is the frozen upstream snapshot used
  as PR #69's base.
- `reconcile/dsh-ec2-upstream-20260913` is the reviewed EC2 topic branch.
- PR #69 is not a request to merge into the FLINTER default `master`/`main`.
  A future release may deploy an exact reviewed SHA from this lineage without
  changing the FLINTER aggregate branch.

## AWS target discovery

- AWS CLI identity check succeeded through the `flinter` IAM Identity Center
  profile. The raw identity and account details are intentionally not copied
  into this record.
- Region checked: `us-east-2`.
- Candidate DSH host: `flinter-orca-dsh`, instance
  `i-09cc08b3fdad49cf5`.
- Instance type: `t4g.medium`; architecture: `arm64`; platform: Linux/UNIX.
  This confirms the requested size/architecture at the EC2 metadata level.
- State during deployment: `running`.
- Systems Manager during deployment: `Online`.
- The attached instance profile is `flinter-bastion-ssm`. Its role has the
  standard `AmazonSSMManagedInstanceCore` policy and reviewed inline read
  policies for the configured DSH provider secrets and ARK plan secret. The
  intentionally unused Modelflare provider is not a deployment prerequisite.
- The target security group is `flinter-bastion-sg`, described as SSM outbound
  only: it has no inbound rules and unrestricted egress. The subnet has an
  Internet Gateway route, but this security group does not provide public Web
  ingress. The safe validation path is SSM port forwarding or an explicitly
  approved ingress layer, not an implicit firewall opening.

Live-host facts collected through SSM: `aarch64`, Ubuntu 22.04, Node
`v22.23.2`, pnpm `11.7.0`, approximately 3.7 GiB RAM, no swap, and
approximately 27 GiB free disk. The existing `/opt/dsh-phase2` checkout was
clean at the preserved legacy SHA before deployment; its source checkout
remains separate from `/opt/dsh-phase2/releases/<source-sha>`. The `tod`
profile, service unit, explicit `DSH_COMPUTE_BACKEND=ec2`, and named Cloudflare
tunnel were verified. The deployed release is now the exact SHA recorded above.

## CI and artifact-store discovery

- The current worktree has no `.circleci` configuration.
- The checked-in EC2 workflow is
  `.github/workflows/deploy-dsh-ec2.yml`; the destination worktree now
  replaces the former host-build/self-hosted-x64 path with a native Linux
  ARM64 build job plus an SSM activation job. Its build job was exercised
  successfully as run `34791268500`. The protected environment now contains
  the OIDC role, artifact bucket, and prefix; the separate deployment job is
  intentionally not triggered from this draft PR because its event is
  protected `master`/manual dispatch. The equivalent exact-SHA deployment was
  performed through SSM.
- The repository already demonstrates an ARM64 GitHub-hosted runner label
  (`ubuntu-24.04-arm`) in other workflows; run `34791268500` confirmed its
  suitability for this DSH runtime artifact.
- The private account-owned artifact bucket is
  `flinter-dsh-ec2-artifacts-527947547848-us-east-2`, region `us-east-2`.
  Versioning, public-access blocking, owner-enforced object ownership, and
  server-side AES256 encryption are enabled. The EC2 role has read access only
  below `dsh-ec2/`; the GitHub OIDC deploy role is scoped to the repository,
  protected environment, artifact prefix, target instance, and SSM command
  type.
- The destination worktree now contains a runtime manifest, immutable release
  pointer, checksum-verified extraction path, and artifact-based EC2 activation
  in `deploy/dsh-ec2/deploy.sh`; the old host `pnpm install`/`build:lib` path is
  no longer used by the new artifact mode. This is source/worktree evidence,
  not a live-host deployment claim.
- Native Linux ARM64 workflow run `34791268500` passed immutable install,
  library build, artifact build/verification, and artifact upload for source
  SHA `abbddead9b0a53c31e2e41b673bda21e45d710a4`. The downloaded archive's
  detached checksum and manifest source SHA were independently verified. The
  exact archive was uploaded to S3 and activated on EC2 by SSM command
  `77817d8d-a6ba-419f-b6ab-1fee879df5fb`.

## Phase 0 verdict

The target architecture is known: **Linux ARM64 on `t4g.medium`**. Discovery,
artifact distribution, exact-SHA activation, and redacted local ingress gates
are closed for `abbddead9b…`. Authenticated Web E2E and rollback rehearsal are
still open; the source remains on draft PR #69 and has not been merged into the
FLINTER default branch.

### Next authorized in-scope step

1. Run authenticated Web/profile E2E against the exact deployed SHA without
   printing or placing credentials in the artifact.
2. Rehearse a controlled post-switch failure and verify the saved previous
   release pointer returns the legacy service to health.
3. Decide whether this reviewed upstream reconciliation should be promoted in
   its own release process; do not merge it into the FLINTER default branch as
   an upstream-core update.

The exact-SHA EC2 activation is evidenced above, but this discovery record does
not by itself declare production readiness.

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

The artifact-based deployment script and ARM64 CI workflow are pushed in the
destination worktree. The exact Linux artifact was published to the private
store and run through SSM; no source checkout on EC2 was rebuilt. The EC2
service was restarted from the immutable release and passed its redacted
health checks. CodeSandbox remains outside this P0 deployment.
The full `pnpm run build:lib` also passes after the private composition root
adds a no-op tsdown input configuration; the composition root is not treated
as a normal library bundle.
