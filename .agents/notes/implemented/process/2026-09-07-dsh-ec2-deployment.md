# Agent Note: Automate DSH Web EC2 deployment through GitHub OIDC and SSM

Status: implemented

English | [中文](2026-09-07-dsh-ec2-deployment.zh.md)

## Problem

The live DSH Web host had been repaired through a manual EC2/SSM operation, but the source checkout did not yet contain a repeatable deployment path. A future profile or provider change could therefore drift from the tested source, and a manual restart could not prove that the exact Git revision was running.

## Decision

Add a repository-owned GitHub Actions workflow that authenticates with GitHub OIDC, checks EC2 and SSM readiness, and sends an exact-commit deployment script through `AWS-RunShellScript`. The script refuses a stopped host, an SSM-offline target, a mismatched origin, or a dirty live checkout; backs up the DSH profile; installs the frozen lockfile; rebuilds the AWS credential provider and FLINTER profile; reapplies the profile bundle; verifies the AWS reference path and the unauthenticated Web health response; and rolls back the checkout/profile if a post-switch step fails.

The workflow intentionally does not create the account-level GitHub OIDC provider or IAM role. Those trust settings belong to the AWS infrastructure owner and must be configured once with repository/ref conditions. The EC2 instance role, not the GitHub deployment role, remains the authority for DSH Secrets Manager reads.

## Alternatives considered

**Store a long-lived AWS access key in GitHub.** Rejected because OIDC removes the standing credential and keeps the deployment role separate from DSH runtime secret access.

**Introduce CodePipeline or CodeDeploy.** Rejected for this host because the current deployment unit is one systemd service and one Git checkout; SSM gives the needed exact-commit and host-level transaction without inventing a second application deployment plane.

**Force-reset the live checkout or start the instance automatically.** Rejected because a dirty checkout may contain operator data and starting a stopped EC2 instance is a cost and availability decision. The workflow fails closed and requires explicit reconciliation.

## Consequences

Pushes to `master` can deploy the DSH Web source after the protected environment and IAM trust are configured. Deployments are serialized, auditable by commit and SSM command ID, and leave a host-side rollback backup. A green source check does not become live-cloud evidence until the workflow reaches the target and reports its redacted success line. Browser authorization records remain process-local across restarts, while model API-key references continue to be resolved from Secrets Manager at request time.
