---
description: "Build shell-free DSH worker launches with isolated attempt roots, secret-free manifests, and lease-aware lifecycle checks."
kind: "package-library"
---

# @deepseek-ai/dsh-alpha-profile

English | [中文](README.zh.md)

## Summary

This private library lets the FLINTER worker launcher build a direct DSH process specification and a fresh filesystem envelope for each execution attempt. It preserves one durable DSH session root across replacement attempts while keeping scratch, evidence, and launch metadata attempt-local. It also provides injected executor fencing, stale callback rejection, and the canary proof required before fan-out. It does not own cloud placement, callback authentication, or DSH model/API recovery.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Import the library from the worker launcher after it has parsed the DSH environment contract.

### When to use it

Use this package for non-Orca launch and attempt safety around the native DSH Agent and Session. The control-plane or executor integration must provide the authenticated callback path, cloud task identity, stop operation, and terminal-state observation.

### Entry point

The launch flow is `resolveWorkerAttemptRoots()` → `createWorkerAttemptRoots()` → `writeWorkerAttemptManifest()` → `buildDshAttemptLaunch()`. Pass the returned launch spec to a direct child-process API with `shell: false`; the task remains one literal argument. Use `fenceWorkerAttempt()` before starting a replacement, `cleanupWorkerAttempt()` only after its terminal proof, and call `assertWorkerCanaryProof()` before enabling fan-out.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`attempt.ts` separates the durable `DSH_SESSION_ROOT` from per-attempt scratch and artifact roots, writes the launch manifest with an exclusive owner-only create, scrubs inherited credential-shaped environment names, and removes only ephemeral roots after a terminal fence. `lifecycle.ts` keeps physical executor fencing and logical lease fencing as separate checks. The exact exported contracts live in [src/attempt.ts](src/attempt.ts) and [src/lifecycle.ts](src/lifecycle.ts); the DSH identity and create/resume binding remain in [src/worker.ts](src/worker.ts).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [DeepSeek Harness architecture](../../../docs/architecture.md) — profiles, application launch, and capability ownership.
- [Defensive patterns](../../../docs/defensive-patterns.md) — subprocess environment and private-path rules.
- [Agent Note: DSH attempt runtime safety](../../../.agents/notes/implemented/architecture/2026-08-29-dsh-attempt-runtime-safety.md) — the durable session versus ephemeral attempt decision.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Cloud executor integration** — AWS/Beam stop, terminal-state polling, and placement remain control-plane/executor work; this package accepts them through `WorkerAttemptFenceExecutor`.
- **Callback authentication and delivery** — the callback URL and secret reference are launch inputs, but HMAC verification and authoritative callback mutation remain outside this library.
- **Provider recovery** — model/API retry and route fallback remain DSH responsibilities; worker replacement is a control-plane decision after physical and logical fencing.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The package is private and is currently the reusable safety layer beside the alpha worker adapter. Its acceptance suite is [tests/attempt.spec.ts](tests/attempt.spec.ts) and [tests/lifecycle.spec.ts](tests/lifecycle.spec.ts).

</details>
