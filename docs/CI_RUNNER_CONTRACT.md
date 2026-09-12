# CI runner contract

English | [中文](CI_RUNNER_CONTRACT.zh.md)

## Linux x64

Repository jobs that can execute on Linux x64 use the registered AWS EC2 self-hosted runner:

```yaml
runs-on: [self-hosted, linux, x64, ci-linux]
```

Jobs that receive a generated matrix may select the same runner through the `ci-linux` label. The label is intentionally repository-specific so a job cannot land on an unrelated self-hosted machine.

The runner is a trust boundary. It must be dedicated to this repository, clean between jobs (prefer an ephemeral image or an equivalent reset), and must not contain long-lived AWS, GitHub, npm, or provider credentials. CI checkouts that execute repository code disable persisted Git credentials. Protected deployment and publication environments remain responsible for their own GitHub environment approvals and OIDC/token policy.

## Platform exceptions

The current EC2 runner is Linux x64. Native platform jobs therefore remain on the platform that can execute them:

- `ubuntu-24.04-arm` for Linux ARM64 native builds;
- `windows-latest` or `windows-2025` for native Windows builds and tests;
- `macos-latest` for native macOS builds and tests.

These exceptions are intentional and are checked by the runner policy. They do not move the Linux x64 CI gate back to GitHub-hosted infrastructure.

## Verification

`pnpm run verify-ci-runner-policy` checks every workflow selector. A green policy check proves only that the checked-in selectors are approved; it does not prove that GitHub has a registered online runner. Runner registration, labels, service health, and a successful workflow dispatch must be verified in the GitHub organization separately.
