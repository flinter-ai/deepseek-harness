---
description: "使用隔离的 attempt 根目录、无 secret 的 manifest 和基于 lease 的生命周期检查构建无 shell 的 DSH worker 启动。"
kind: "package-library"
---

# @deepseek-ai/dsh-alpha-profile

[English](README.md) | 中文

## Summary

这个 private library 让 FLINTER worker launcher 为每次执行 attempt 构建直接的 DSH 进程规格和全新的文件系统封装。它在 replacement attempt 之间保留一个持久的 DSH session 根目录，同时让 scratch、evidence 和启动 metadata 保持在各自的 attempt 范围内。它还提供由调用方注入的 executor fencing、过期 callback 拒绝，以及 fan-out 前必须满足的 canary proof。它不负责 cloud placement、callback authentication 或 DSH model/API recovery。

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

在解析 DSH environment contract 后，从 worker launcher 引入这个 library。

### When to use it

在 native DSH Agent 和 Session 周围实现非 Orca 的 launch 和 attempt safety 时使用这个 package。control-plane 或 executor integration 必须提供经过 authentication 的 callback 路径、cloud task identity、stop 操作和 terminal-state observation。

### Entry point

启动流程是 `resolveWorkerAttemptRoots()` → `createWorkerAttemptRoots()` → `writeWorkerAttemptManifest()` → `buildDshAttemptLaunch()`。将返回的 launch spec 传给 `shell: false` 的直接 child-process API；task 始终是一个 literal argument。启动 replacement 前使用 `fenceWorkerAttempt()`，只有在获得 terminal proof 后才能使用 `cleanupWorkerAttempt()`，启用 fan-out 前调用 `assertWorkerCanaryProof()`。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`attempt.ts` 将持久的 `DSH_SESSION_ROOT` 与每个 attempt 的 scratch 和 artifact 根目录分开，以 exclusive、owner-only 的方式创建 launch manifest，清理继承环境中名称像 credential 的变量，并且只在 terminal fence 后移除临时根目录。`lifecycle.ts` 将 physical executor fencing 与 logical lease fencing 保持为两个独立检查。完整的 export contract 见 [src/attempt.ts](src/attempt.ts) 和 [src/lifecycle.ts](src/lifecycle.ts)；DSH identity 以及 create/resume binding 仍由 [src/worker.ts](src/worker.ts) 负责。

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [DeepSeek Harness architecture](../../../docs/architecture.zh.md) — profile、application launch 和 capability ownership。
- [Defensive patterns](../../../docs/defensive-patterns.zh.md) — subprocess environment 和 private-path 规则。
- [Agent Note: DSH attempt runtime safety](../../../.agents/notes/implemented/architecture/2026-08-29-dsh-attempt-runtime-safety.zh.md) — 持久 session 与临时 attempt 的决策。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Cloud executor integration** — AWS/Beam stop、terminal-state polling 和 placement 仍属于 control-plane/executor 工作；这个 package 通过 `WorkerAttemptFenceExecutor` 接收这些能力。
- **Callback authentication and delivery** — callback URL 和 secret reference 是 launch input，但 HMAC verification 和 authoritative callback mutation 仍在这个 library 之外。
- **Provider recovery** — model/API retry 和 route fallback 仍由 DSH 负责；worker replacement 必须在 physical 与 logical fencing 后才由 control plane 决定。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

这个 package 是 private 的，目前是 alpha worker adapter 旁边的 reusable safety layer。它的 acceptance suite 是 [tests/attempt.spec.ts](tests/attempt.spec.ts) 和 [tests/lifecycle.spec.ts](tests/lifecycle.spec.ts)。

</details>
