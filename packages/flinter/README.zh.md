---
description: "flinter package 组：基于 DSH seam 管理提供方选择、凭据与 AWS worker composition 的 FLINTER profile overlay。"
kind: "package-group"
---

# flinter/：FLINTER DSH profile overlay

[English](README.md) | 中文

## 概述

`flinter/` 组包含 FLINTER 自有的 overlay，在公开 DSH seam 之上组合提供方 profile、凭据引用、计算选择与 AWS worker 启动行为。FLINTER 主机需要自己的路由或 worker policy 时使用这些 package；agent loop、session format 与 provider adapter 仍由 DSH core 负责。这些 overlay 不创建第二套 harness 安装，也不存储 secret 值。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

这两个 package 将通用 profile composition 与 AWS worker 凭据 overlay 分开。

| 包 | 角色 |
|---|---|
| [`dsh-alpha-profile/`](dsh-alpha-profile/README.zh.md) | 组合 FLINTER 提供方路由、计算选择与 DSH worker attempt policy |
| [`dsh-aws-worker-profile/`](dsh-aws-worker-profile/README.zh.md) | 为 worker 主机提供只读 AWS credential-provider overlay |

<a id="related-documentation"></a>
## 相关文档

- [能力 seam](../../docs/capability-seams.zh.md)——这些 overlay 所消费的 service boundary。
- [凭据子系统](../../docs/subsystems/credentials.zh.md)——由主机拥有的凭据引用约定。
- [host package 组](../host/README.zh.md)——挂载这些 overlay 的 runtime host package。

<a id="dev-note"></a>
## 开发备注

无。
