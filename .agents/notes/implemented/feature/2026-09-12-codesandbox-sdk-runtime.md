# Agent Note: Official CodeSandbox runtime

Status: implemented

English | [中文](2026-09-12-codesandbox-sdk-runtime.zh.md)

## Problem

The platform-neutral compute contract had only an injected CodeSandbox
interface. That was enough for unit tests but did not connect the DSH harness
to a real CodeSandbox VM, and the vendor SDK's array command form did not
preserve literal argv semantics.

## Decision

`dsh-alpha-profile` now depends on the official `@codesandbox/sdk` and exports
`CodeSandboxSdkRuntime`. It creates private, bounded CodeSandbox sandboxes
(implemented by CodeSandbox with microVMs), maps the profile's case-insensitive
tier names to SDK `VMTier` values, connects with a write session, executes one
shell-quoted literal-argv transport, and shuts down the sandbox after the
command completes or is stopped. The SDK API token is host-only;
provider credentials and the token are rejected from the sandbox environment.

When the host supplies `workspaceSeed`, the runtime writes a tracked-only
source archive into the sandbox, verifies its archive SHA-256 and exact source
SHA, and extracts it into `/project/sandbox` before execution. `templateId`
remains an optional CodeSandbox bootstrap/fork source; it is not the GitHub
source of truth.

The official `csb` CLI remains the operator surface for listing and managing
sandbox lifecycle/preview resources. It is not used as a substitute for the
SDK command adapter because it does not provide the required runtime object.
EC2 continues to select `DSH_COMPUTE_BACKEND=ec2` in its protected systemd
drop-in; the CodeSandbox default does not override that host setting.

## Consequences

The harness has a real CodeSandbox execution path without modifying the DSH
runner or keeping a second worker implementation. Local admission remains
process-local evidence. CodeSandbox shutdown/resume persists files in
CodeSandbox only; durable session JSONL, manifests, and artifacts still need
an AWS storage adapter or reviewed shared mount. Durable multi-host
admission/fencing and a reviewed short-lived model-credential broker are also
required before provider-backed CodeSandbox workers are production-ready.

## Testing

The profile suite and SDK runtime unit tests pass, including the tracked source
archive seed path. A live no-credential E2E previously created a private Pico
sandbox, executed a literal argv payload, and shut it down successfully. A
later full source-seed/template-fork probe was blocked before sandbox creation
because the CodeSandbox workspace was frozen by its spending limit. No secret
values are stored in the repository or emitted by the tests.
