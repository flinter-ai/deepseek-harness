# Agent Note: aws-runtime integration branch and keyless structural smoke

Status: implemented

English | [中文](2026-08-18-aws-runtime-integration-branch.zh.md)

## Problem

Three independently developed capabilities — the Bedrock LLM provider (`flinter/llm-pi-ai-bedrock`), the AWS Secrets Manager credentials provider (`flinter/credentials-aws-secrets-manager`), and the Orca worker bridge (`flinter/dsh-orca-plugin`) — had no single branch where their composition was proven. Composition failures (duplicate rows, missing services, boot-time cloud calls) would otherwise surface only when a deployment first combined them.

## Decision

### `flinter/aws-runtime` is the FLINTER AWS integration trunk

`master` stays an exact upstream mirror (fast-forward only, no product code). The three capability branches merge into `flinter/aws-runtime` with `--no-ff`, preserving each capability's history. Future FLINTER AWS product branches fork from `aws-runtime`, never from a sibling feature branch and never into `master`.

### Composition is proven by a keyless structural smoke

`examples/aws-headless/` holds a profile template (`profile/package.json` listing the `@deepseek-ai/dsh-base` and `@flinter/dsh-orca` bundles, `profile/cordis.patch.yml` swapping the credential store and enabling the catalog `amazon-bedrock` route) and `tests/aws-headless.e2e.ts`, which materializes the profile into a temp `DSH_HOME` — profile-local `node_modules` symlinks stand in for `dsh plugin add` — and runs two gates:

- **Composition gate**: the real `--dump-config` CLI path prints each capability's rows exactly once, with the local credential row present but disabled.
- **Boot gate**: an in-process `boot()` over the real profile layers activates all three capabilities (`ctx.credentials` is the Secrets Manager provider, `amazon-bedrock` is a registered LLM route, the five Orca tools are registered) and disposes cleanly. The environment is stripped of every `AWS_*` variable with IMDS disabled, so any AWS call during boot would fail loud; a green boot is the zero-network-call proof.

Neither gate requires credentials, and neither dispatches an AWS request. A credential-aware live smoke is a separate, later, gated test.

## Alternatives considered

**Boot the headless profile with a trivial prompt.** The headless bundle is a one-shot runner: once the loader settles it creates an agent and calls the default model, turning a structural check into a live Bedrock call. The smoke therefore composes over `dsh-base` only and never creates an agent.

**`instanceof` on the credentials provider.** The test imports package sources through the tsconfig `paths` facade while the Loader resolves package exports to `lib/`; the two class objects differ across planes, so the assertion uses `constructor.name`.

## Consequences

- `flinter/aws-runtime` is the only trunk that composes the three capability branches; sibling feature branches and `master` never carry the composition.
- The keyless structural smoke proves the composition with zero AWS calls and no credentials: the composition and boot gates assert the composed rows and clean disposal, and the environment is stripped of every `AWS_*` variable with IMDS disabled, so a boot-time cloud call would fail loud.
- A credential-aware live smoke and any real AWS request remain separate, later, gated tests.
