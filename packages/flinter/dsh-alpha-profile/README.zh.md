---
description: "固定 DeepSeek Harness alpha 之上的 FLINTER Phase 1 提供方/profile、worker 启动与 attempt safety seam。"
kind: "package-reference"
---

# @deepseek-ai/dsh-alpha-profile

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-alpha-profile` 是固定 DeepSeek Harness alpha 之上的公开 FLINTER 设置与 worker 启动层。它描述 ARK、Modelflare、GMI Serving 以及 direct DeepSeek 的路由引用，记录模型级上下文与输出容量，提供可选择的 reasoning 等级，并把控制平面 worker attempt 绑定到一个 DSH session 与持久化根目录。agent loop、Session/event codec、提供方构建、凭据解析与工具运行时仍由 DSH 负责。

## 目录

- [使用本包](#use-this-package)
- [路由与 worker 边界](#route-and-worker-boundaries)
- [Attempt safety](#attempt-safety)
- [实现说明](#understand-the-implementation)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

当宿主需要 FLINTER 提供方设置，或需要从控制平面 stamped environment 启动 worker 时使用本包。包只输出 `ARK_PLAN_API_KEY` 等凭据引用，不输出 secret 值。新 session 捕获一个 provider/model 路由；UTC 轮换只影响之后的新 session。replacement attempt 必须推进 lease 与 attempt identity，同时保留相同的 `dshSessionId` 与 `dshSessionRoot`。

`contextWindow` 与可选的 `maxTokens` 是各路由 `models` 条目中的模型级字段，不是全局 reasoning 声明，也不表示真实提供方已经接受请求。`reasoningEfforts` 允许部署只暴露已验证的 endpoint 等级；当前默认 profile 为 ARK 与 Modelflare 记录兼容的 `high` wire 值。

<a id="route-and-worker-boundaries"></a>
## 路由与 worker 边界

- UTC 16:00–24:00 的新 session 默认使用 ARK。
- 其他时间的轮换路由是 Modelflare。
- GMI Serving 只允许显式选择，不参加自动轮换。
- Direct DeepSeek 仍是独立的 `dsh-llm-deepseek` 路由。
- AWS 通过公开的 `@deepseek-ai/dsh-credentials-aws-secrets-manager` provider seam 消费同一凭据引用；本包不读取或同步 AWS secrets。
- Agent Teams、Runta、Beam、Tower 与控制平面仍是独立能力。

## 一个 Harness、两个凭据后端

`buildFlinterProfileComposition('tod')` 和 `buildFlinterProfileComposition('aws-worker')` 描述相同的 `dsh-base` 加 `dsh-headless` 组合。AWS 版本只替换 `ctx.credentials` provider 行，并提供公开的引用到 secret 名称映射。它不会创建第二套 DSH 安装、agent loop、Session codec 或 provider catalog。

本地 `tod` launcher 仍是 source checkout 的便利封装。AWS worker profile 是后续部署 probe 使用的精简只读 overlay；它不是部署清单，也不包含账户或 secret 材料。

## 一个 worker 合约、可切换的计算平台

`DSH_COMPUTE_BACKEND` 在 `codesandbox`、`ec2` 与 `local` 之间选择；未设置
时默认使用 `codesandbox`。本地启动器会显式写入这个默认值，而 EC2 公网
Web 的 systemd overlay 会显式写入 `ec2`，这样渐进迁移期间不会把旧主机误标
为其他平台。平台选择不会改变 DSH session 或 JSONL 持久化根目录：存储仍是
持久化权威，计算资源可以替换。

`readDshComputeAdmissionPolicy()` 默认只允许一个活动 worker，最长运行 30
分钟、空闲 5 分钟，CodeSandbox 休眠超时为 5 分钟。`DshComputeAdmission`
还会限制每个 session 同时只有一个 attempt，因此 replacement 必须先完成
物理与逻辑 fencing，才能取得新的 lease。

`CodeSandboxSdkRuntime` 是 CodeSandbox runtime seam 的官方
`@codesandbox/sdk` 实现。宿主从 secret store 提供 `apiToken` 或
`CSB_API_KEY`，再把它交给 `CodeSandboxComputeBackend`：

```ts
const runtime = new CodeSandboxSdkRuntime({ apiToken: process.env.CSB_API_KEY })
const backend = new CodeSandboxComputeBackend({ runtime, vmTier: 'pico' })
```

runtime 会创建 private VM、映射受限的 tier/休眠策略、通过 SDK 连接，使用
保留 literal argv 语义的固定 shell-quoted transport 执行命令，并在完成后
shutdown。token 和 provider credential 都不会转发到 sandbox 环境。官方
`csb` CLI 适合 list、hibernate、shutdown 以及 preview/host-token 资源管理；
它与 SDK 互补，但不是命令执行 adapter。

control plane 或 executor 仍必须提供共享 admission 与持久 fencing。
`DshComputeAdmission` 只是进程内证据，不能单独证明多主机的分布式容量。
EC2 部署在受保护的 systemd drop-in 中显式设置
`DSH_COMPUTE_BACKEND=ec2`，因此 CodeSandbox 默认值只适用于明确选择它的宿主。

<a id="attempt-safety"></a>
## Attempt safety

在 native DSH Agent 和 Session 周围实现非 Orca launch 与 attempt safety 时使用本包。control-plane 或 executor integration 必须提供经过 authentication 的 callback 路径、cloud task identity、stop 操作和 terminal-state observation。

启动流程是 `resolveWorkerAttemptRoots()` → `createWorkerAttemptRoots()` → `writeWorkerAttemptManifest()` → `buildDshAttemptLaunch()`。将返回的 launch spec 传给 `shell: false` 的直接 child-process API；task 始终是一个 literal argument。启动 replacement 前使用 `fenceWorkerAttempt()`，只有在获得 terminal proof 后才能使用 `cleanupWorkerAttempt()`，启用 fan-out 前调用 `assertWorkerCanaryProof()`。

`attempt.ts` 将持久的 `DSH_SESSION_ROOT` 与每个 attempt 的 scratch 和 artifact 根目录分开，以 exclusive、owner-only 的方式创建 launch manifest，清理继承环境中名称像 credential 的变量，并且只在 terminal fence 后移除临时根目录。`lifecycle.ts` 将 physical executor fencing 与 logical lease fencing 保持为两个独立检查。

<a id="understand-the-implementation"></a>
## 实现说明

完整的 attempt 与 lifecycle contract 从 [src/attempt.ts](src/attempt.ts) 和 [src/lifecycle.ts](src/lifecycle.ts) 导出；DSH identity 以及 create/resume binding 仍由 [src/worker.ts](src/worker.ts) 负责。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **配置不能证明真实提供方容量**——mock endpoint 只验证形状与选择；付费提供方调用与 AWS 部署属于独立证据 gate。
- **当前路由目录有意保持精简**——增加模型或 reasoning 等级需要明确的 endpoint 验证与 profile review。
- **live CodeSandbox VM 不是 model credential bridge**——VM 内的 provider 调用需要另行审查的短期 credential/broker 路径；原始 provider key 仍由宿主持有。
- **CodeSandbox workspace 不是 AWS 持久化**——shutdown/resume 只保留 CodeSandbox 文件。Session JSONL、manifest 和 artifact 在 CodeSandbox worker 达到 storage-ready 前，仍需要另行实现的 AWS storage adapter 或经过审查的共享挂载。
- **真实 AWS 与下游迁移仍延期**——本包不扩展 Session codec，也不实现真实 AWS 部署或 trace-link；公开 AWS provider 只在 Phase 1 使用 mock 证据。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本开发备注是维护者工作上下文，记录开放问题与延期方向，不是权威规范；已发布行为与限制以本页前文和包代码为准。Attempt 与 lifecycle safety 的验收测试见 [tests/attempt.spec.ts](tests/attempt.spec.ts) 和 [tests/lifecycle.spec.ts](tests/lifecycle.spec.ts)。

#### 未来：更丰富的路由能力协商

更多 reasoning 等级、提供方专属容量覆盖与实时提供方健康策略会延期到各 endpoint 完成明确的兼容性与证据 gate 之后。

</details>
