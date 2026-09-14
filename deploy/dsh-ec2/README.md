# DSH Web EC2 deployment

English | [中文](README.zh.md)

This directory owns the repeatable deployment path for the existing DSH Web
systemd service on EC2. CI builds a pinned Linux ARM64 runtime artifact; AWS
Systems Manager (SSM) sends the source SHA and immutable artifact URI to the
host, which verifies the archive and activates it through an atomic release
pointer. EC2 does not run `pnpm install` or `pnpm run build:lib` during a
production deployment. Model API keys remain outside systemd and the process
environment.

## What runs automatically

`.github/workflows/deploy-dsh-ec2.yml` runs on pushes to `master` when the DSH
runtime, profile, provider, or deployment files change. It can also be started
manually with an explicit Git ref. The workflow:

1. checks out one exact commit on a native Linux ARM64 runner and records its
   full SHA;
2. installs the lockfile, builds the library artifacts in CI, and produces the
   symlink-free runtime archive and embedded/sibling manifests;
3. publishes the archive, detached checksum, and sibling manifest under the
   configured versioned S3 prefix;
4. authenticates to AWS with GitHub OIDC and a narrowly scoped deployment role;
5. refuses a stopped EC2 instance or an SSM-offline target;
6. sends `deploy.sh`, the source SHA, and the artifact URI to the target through
   `AWS-RunShellScript`;
7. verifies the checkout origin and protected ingress, backs up persistent
   profile/settings state, downloads and verifies the artifact, and atomically
   switches `/opt/dsh-phase2/releases/current`;
8. resolves the Ark reference through the EC2 instance role, restarts
   `dsh.service`, checks port `3080`, expects HTTP `401` from the unauthenticated
   root, and checks that credential-shaped environment variables are absent.

The workflow is serialized so two deployments cannot mutate the same profile
at once. The remote script rolls back the release pointer and profile files if
a post-switch step fails. Backups stay on the host under
`/var/lib/dsh-phase2/deploy-backups`.

The one-time legacy migration is fail-closed: it removes the user-patch tail
only when that tail is byte-for-byte identical to the checked-in AWS worker
bundle. Any customized or ambiguous overlay stops deployment and is restored
from the profile backup. Releases are retained by source SHA so a failed
post-switch check can restore the previous `current` target without rebuilding.

## Idle-stop safety boundary

The EC2 deployment enables the opt-in `dsh-host-idle-guard` and installs a
separate `dsh-idle-stop.timer`. The guard atomically writes only a redacted
snapshot under `/var/lib/dsh-phase2/idle-state.json`; the controller requires
all HTTP, WebSocket, job, and PTY counts to be zero, a fresh state file, no
deployment lock, and 30 minutes since the last accepted application activity.
Missing, malformed, stale, or clock-inconsistent state is fail-closed. An
operator can place `/var/lib/dsh-phase2/idle-stop.hold` to suppress shutdown.

The controller stops `dsh.service` before requesting `systemctl poweroff`; it
never runs inside the DSH process and never uses CPU percentage as proof that
work is idle. The pre-existing slower CloudWatch CPU alarm remains a fallback
until its account-level policy is separately reviewed. A dry-run check is safe:

```bash
sudo DSH_IDLE_STOP_DRY_RUN=1 \
  /usr/local/libexec/dsh-phase2/idle-stop.sh
```

## Stable Cloudflare ingress (one-time host provisioning)

The DSH service stays bound to loopback. The reviewed public path is a separate
named Cloudflare tunnel, `dsh-ec2-phase2`, routing
`dsh-web.useflinter.com` to `127.0.0.1:3080`; it does not require an EC2
security-group ingress rule. The checked-in tunnel config and systemd unit are:

- `cloudflared/dsh-ec2-phase2.yml`;
- `cloudflared/dsh-ec2-phase2-named-tunnel.service`; and
- `systemd/10-dsh-web-public-host.conf`.

The tunnel credential is never stored in Git. Before provisioning, install the
account-owned credential at `/etc/cloudflared/dsh-ec2-phase2.json` with owner
`ubuntu:ubuntu` and mode `600`, and ensure the maintained
`/home/ubuntu/bin/cloudflared` binary is present. Then run the checked-in
installer as root from the live checkout:

```bash
sudo env DSH_REPOSITORY_ROOT=/opt/dsh-phase2 \
  /opt/dsh-phase2/deploy/dsh-ec2/install-ingress.sh
```

The installer validates the credential permissions, DSH health, and
`cloudflared` ingress syntax, installs only exact tracked files, and enables
the tunnel. It refuses to overwrite a differing managed file. Use its
explicit `--replace` mode only after reviewing the existing file; any replaced
unit/config/drop-in is copied to a timestamped host backup. The installer does
not create DNS records or tunnel credentials; those remain account-owner
operations.

The normal deployment script performs a stronger preflight on every code
deployment: it compares the live tunnel config and tunnel unit with the
requested deployment SHA, checks the tunnel credential mode/owner and service
state, and fails before stopping DSH on any mismatch. During activation it
installs the requested trusted-host drop-in, verifies the immutable release
launcher, and only then restarts DSH. This prevents a later deployment or
reprovisioning step from silently losing the stable hostname trust.

The public hostname still requires DSH's authority-bound browser token and
session cookie. Mint a fresh token for the stable hostname; a cookie minted for
`127.0.0.1` is intentionally not valid for the public authority. Cloudflare
Access policy is not installed by this repository path.

## One-time repository and AWS configuration

Create a protected GitHub Actions environment named `dsh-ec2-production` and
set these non-secret environment variables:

| Variable | Value |
|---|---|
| `DSH_AWS_REGION` | `us-east-2` for the current DSH Web host. |
| `DSH_EC2_INSTANCE_ID` | The intended DSH Web EC2 instance ID. |
| `DSH_DEPLOY_ROLE_ARN` | The IAM role trusted by this repository's GitHub OIDC subject. |
| `DSH_ARTIFACT_BUCKET` | Account-owned S3 bucket for immutable DSH runtime artifacts. |
| `DSH_ARTIFACT_PREFIX` | Versioned key prefix reserved for this deployment environment. |

The GitHub role needs the regional EC2 read check, SSM target readiness,
`ssm:SendCommand`, and `ssm:GetCommandInvocation` for the intended instance,
plus `s3:PutObject` for the configured artifact prefix. It does not need
`secretsmanager:GetSecretValue`. The EC2 instance role needs `s3:GetObject` for
that same artifact prefix and remains the authority for the mapped DSH secrets;
it should retain only the read access required by the profile.

The repository currently does not create the GitHub OIDC provider or IAM role
automatically. That is an account-level trust decision and must be provisioned
once through the existing AWS infrastructure owner. This repository uses
GitHub's immutable subject format, so the trust policy must match this exact
environment subject (including the owner and repository IDs):

```text
repo:flinter-ai@316417709/deepseek-harness@1337175939:environment:dsh-ec2-production
```

For this ordinary (non-reusable) deployment workflow, restrict the additional
claim to:

```text
token.actions.githubusercontent.com:workflow_ref =
  flinter-ai/deepseek-harness/.github/workflows/deploy-dsh-ec2.yml@refs/heads/reconcile/dsh-ec2-*
```

Use `workflow_ref`, not `job_workflow_ref`; the latter is for reusable
workflows. The environment's deployment branch policy is a second, independent
guard and should remain `master`-only in steady state. A pre-merge deployment
may temporarily allow one exact reconcile branch, but that policy must be
removed after the run. Until the variables and both trust guards exist, the
workflow fails closed before sending a command.

## EC2 prerequisites

The target must already have:

- the live checkout at `/opt/dsh-phase2` with `origin` set to the canonical
  `https://github.com/flinter-ai/deepseek-harness.git` source;
- a checkout without tracked drift, the `dsh.service` unit, and an active
  listener on `3080`;
- an SSM agent reporting `Online` and an instance profile able to read the
  configured Secrets Manager references and the immutable artifact prefix;
- the persistent DSH home at `/root/.dsh-phase2`, including the `tod` profile;
- a supported Node runtime compatible with the CI artifact (Node 24 for the
  current builder), plus `aws`, `tar`, `sha256sum`, `python3`, and systemd;
  pnpm and the repository's development dependencies are not required on EC2.

The workflow does not start or stop the instance, force-reset tracked checkout
drift, rotate credentials, or expose a public port. Non-colliding untracked
operational files remain in place. A stopped instance is an explicit operator
action followed by a new workflow run. Browser-session authorization records
remain process-local and are recreated after a service restart; model API keys
continue to resolve from Secrets Manager at request time.

## Manual operation and rollback

For a controlled host-side rehearsal, run the same `deploy.sh` as root with
`DSH_DEPLOY_SHA`, `DSH_DEPLOY_REMOTE`, `DSH_DEPLOY_AWS_REGION`,
`DSH_RUNTIME_ARTIFACT_URI`, and optionally
`DSH_RUNTIME_ARTIFACT_SHA256_URI` set. The workflow is the preferred entry
point because it supplies the commit, artifact, and AWS identity without
long-lived GitHub access keys.

If deployment fails after the release switch, the script restores the previous
release pointer and profile files and restarts the service. Inspect the
timestamped backup directory and `journalctl -u dsh.service` on the host; do not print
`.credentials.yaml`, AWS secret values, cookies, bearer tokens, or full process
environments into Actions logs.

## Evidence boundary

A green local build or workflow step proves only the corresponding source,
SSM, and host checks. It does not prove a phone/desktop tunnel, GitHub remote
editing, or a new live deployment unless the workflow itself reaches the
target and reports the redacted `dsh-ec2-deploy: deployment=success` line.

## Model Experience

### Deployment boundary

#### What the model sees

The deployment surface exposes only bounded health and revision facts such as `DSH_DEPLOY_SHA`, authenticated Web status, and `DSH_COMPUTE_BACKEND=ec2`; it never renders AWS secret values or GitHub bearer tokens into model context.

#### Token effect

Deployment metadata contributes no model tokens unless a host explicitly includes a redacted status line in a session; the deployment script keeps credentials and process environments outside the model request.

#### KV Cache effect

Changing the deployed commit or restarting the EC2 service does not rewrite an existing model prefix; a new session observes the new runtime only through the normal host-owned startup and profile composition.
