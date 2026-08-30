---
description: "固定 DeepSeek Harness alpha 之上的 FLINTER Phase 1 提供方/profile 与 worker 启动 seam。"
kind: "package-reference"
---

# @deepseek-ai/dsh-alpha-profile

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-alpha-profile` 是固定 DeepSeek Harness alpha 之上的 FLINTER 设置与 worker 启动层。它描述 ARK、Modelflare、GMI Serving 以及 direct DeepSeek 的路由引用，记录模型级上下文与输出容量，提供可选择的 reasoning 等级，并把控制平面 worker attempt 绑定到一个 DSH session 与持久化根目录。agent loop、Session/event codec、提供方构建、凭据解析与工具运行时仍由 DSH 负责。

## 目录

- [使用本包](#use-this-package)
- [路由与 worker 边界](#route-and-worker-boundaries)
- [模型体验](#model-experience)
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
- AWS 通过同一凭据引用消费 alpha-compatible provider seam；本包不读取或同步 AWS secrets。
- Agent Teams、Runta、Beam、Tower 与控制平面仍是独立能力。

<a id="model-experience"></a>
## 模型体验

### Profile 选择的请求

#### 模型看到的内容

选择的 DSH 模型接收原生 session history、当前 system prompt、工具与用户输入。profile 只提供路由选择与 `contextWindow` 等模型容量元数据，不改写 canonical session events，也不创建平行 prompt history。

#### Token 影响

所选模型声明的 `contextWindow` 与可选 `maxTokens` 通过 DSH 原生模型配置约束请求组装与输出接纳。精确 tokenization 与提供方接纳仍由提供方决定。

#### KV Cache 影响

新 session 的路由会被捕获。复用 session 会保留其 provider/model 路由；修改时段默认值只影响新 session，因此不会静默改变已有请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **配置不能证明真实提供方容量**——mock endpoint 只验证形状与选择；付费提供方调用与 AWS 部署属于独立证据 gate。
- **当前路由目录有意保持精简**——增加模型或 reasoning 等级需要明确的 endpoint 验证与 profile review。
- **worker、AWS 与下游迁移仍延期**——本包不扩展 Session codec，也不实现 lease、fencing、callback、retry、真实 Secrets Manager 或 trace-link 等职责。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本开发备注是维护者工作上下文，记录开放问题与延期方向，不是权威规范；已发布行为与限制以本页前文和包代码为准。

#### 未来：更丰富的路由能力协商

更多 reasoning 等级、提供方专属容量覆盖与实时提供方健康策略会延期到各 endpoint 完成明确的兼容性与证据 gate 之后。

</details>
