# DSH Web EC2 deployment

English | [中文](README.zh.md)

This directory owns the repeatable deployment path for the existing DSH Web
systemd service on EC2. It deploys a pinned Git commit through AWS Systems
Manager (SSM), rebuilds the host and client library artifacts required by DSH
Web (including Typert and browser bundles), reapplies the supported profile
install command, and verifies the authenticated Web endpoint without putting
model API keys in systemd or the process environment.

> **On-demand remote development — no production role.** The EC2 DSH Web host
> (`flinter-orca-dsh`) is retained as a stopped-by-default remote-development
> appliance. This deployment path exists for deliberate operator deployments
> to that environment; it stays manual-only and must never run on push. It is
> not a routine deployment channel — start the host first, and let the
> idle-stop alarm stop it when the session ends.

## What runs

`.github/workflows/deploy-dsh-ec2.yml` is manual-only (`workflow_dispatch`):
it no longer deploys on pushes to `master`, and it stays that way for the rest
of the host's life. It is started manually with an explicit Git ref when a
controlled migration or recovery operation needs it. The workflow:

1. checks out one exact commit and records its full SHA;
2. authenticates to AWS with GitHub OIDC and a narrowly scoped deployment role;
3. refuses a stopped EC2 instance or an SSM-offline target;
4. sends `deploy.sh` to the target through `AWS-RunShellScript`;
5. verifies the checkout origin, rejects tracked drift or untracked files that
   collide with the target commit, backs up the profile files, installs the
   frozen lockfile, builds the host and client library artifacts required by
   DSH Web, migrates an exact legacy AWS overlay to the supported profile
   bundle, and reapplies that bundle;
6. resolves the Ark reference through the EC2 instance role, restarts
   `dsh.service`, checks port `3080`, expects HTTP `401` from the unauthenticated
   root, and checks that credential-shaped environment variables are absent.

The workflow is serialized so two deployments cannot mutate the same profile
at once. The remote script rolls back the Git revision and profile files if a
post-switch step fails. Backups stay on the host under
`/var/lib/dsh-phase2/deploy-backups`.

The one-time legacy migration is fail-closed: it removes the user-patch tail
only when that tail is byte-for-byte identical to the checked-in AWS worker
bundle. Any customized or ambiguous overlay stops deployment and is restored
from the profile backup.

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
deployment: it compares the live tunnel config, tunnel unit, and DSH trusted-
host drop-in with the requested deployment SHA, checks the tunnel credential
mode/owner and service state, and fails before stopping DSH on any mismatch.
This prevents a later deployment or reprovisioning step from silently
restoring the obsolete launch path or losing the stable hostname trust.

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

The GitHub role needs only the regional EC2 read check, SSM target readiness,
`ssm:SendCommand`, and `ssm:GetCommandInvocation` for the intended instance.
It does not need `secretsmanager:GetSecretValue`. The EC2 instance role remains
the authority for the mapped DSH secrets and should retain only the read access
required by the profile.

The repository currently does not create the GitHub OIDC provider or IAM role
automatically. That is an account-level trust decision and must be provisioned
once through the existing AWS infrastructure owner. The role trust policy must
use the canonical `flinter-ai/deepseek-harness` repository's immutable OIDC
subject for the `dsh-ec2-production` environment; the environment's deployment
branch policy separately allows only `master`. Until the three environment
variables and that trust relationship exist, the workflow fails closed before
sending a command.

## EC2 prerequisites

The target must already have:

- the live checkout at `/opt/dsh-phase2` with `origin` set to the canonical
  `https://github.com/flinter-ai/deepseek-harness.git` source;
- a checkout without tracked drift, the `dsh.service` unit, and an active
  listener on `3080`;
- an SSM agent reporting `Online` and an instance profile able to read the
  configured Secrets Manager references;
- the persistent DSH home at `/root/.dsh-phase2`, including the `tod` profile;
- Node and pnpm versions satisfying the repository lockfile and engine policy.

The workflow does not start or stop the instance, force-reset tracked checkout
drift, rotate credentials, or expose a public port. Non-colliding untracked
operational files remain in place. A stopped instance is an explicit operator
action followed by a new workflow run. Browser-session authorization records
remain process-local and are recreated after a service restart; model API keys
continue to resolve from Secrets Manager at request time.

## Manual operation and rollback

For a controlled host-side rehearsal, run the same `deploy.sh` as root with
`DSH_DEPLOY_SHA`, `DSH_DEPLOY_REMOTE`, and `DSH_DEPLOY_AWS_REGION` set. The
workflow is the preferred entry point because it supplies the commit and AWS
identity without long-lived GitHub access keys.

If deployment fails after the checkout switch, the script restores the previous
commit and profile files and restarts the service. Inspect the timestamped
backup directory and `journalctl -u dsh.service` on the host; do not print
`.credentials.yaml`, AWS secret values, cookies, bearer tokens, or full process
environments into Actions logs.

## Evidence boundary

A green local build or workflow step proves only the corresponding source,
SSM, and host checks. It does not prove a phone/desktop tunnel, GitHub remote
editing, or a new live deployment unless the workflow itself reaches the
target and reports the redacted `dsh-ec2-deploy: deployment=success` line.
