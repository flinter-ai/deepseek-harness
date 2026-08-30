---
description: "FLINTER 在固定 DeepSeek Harness alpha 之上的 DSH 集成层包映射。"
kind: "package-group"
---

# flinter/ — FLINTER DSH 集成

[English](README.md) | 中文

## 概述

`flinter/` 组包含 FLINTER 在固定 DeepSeek Harness alpha 之上的组合层。profile 包定义提供方、凭据引用、模型容量、reasoning 与 worker 启动 seam；后续 trace、控制、segment、PES 与 executor 包将逐个消费 DSH 原生约定。DSH 仍负责 agent loop、会话、工具、提供方与凭据；本组不替代控制平面、Tower 科学语义、Runta 执行或保留的 Orca 集成。

## 包

| 包 | 职责 | 状态 |
|---|---|---|
| [`dsh-alpha-profile/`](dsh-alpha-profile/README.zh.md) | alpha 之上的 Phase 1 提供方/profile 与控制平面 worker seam | Phase 1 实现中 |
| [`dsh-aws-worker-profile/`](dsh-aws-worker-profile/README.zh.md) | 共享 alpha bundle 之上的公开只读 AWS 凭据 overlay | Phase 1 兼容 seam；已完成 mock 测试 |

只有在其组件测试与本地 E2E gate 被接受后，才添加后续包。

## 相关文档

- [DSH agent 与 session 子系统](../../docs/subsystems/core.zh.md)
- [凭据子系统](../../docs/subsystems/credentials.zh.md)
- [LLM streaming 子系统](../../docs/subsystems/llm-streaming.zh.md)

## 已知限制与延期工作

- **下游包尚未迁移**——trace-link、agentic-control、segment、PES、executor/Runta 与云集成属于后续阶段。
- **profile 不是生产切换证据**——本地与 mock 提供方测试不能证明真实 AWS、提供方、Tower、Beam 或控制平面行为。
