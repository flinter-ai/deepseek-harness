---
description: "权威 TowerT segment-v1 能力合约的公开 DSH 边界。"
kind: "package-library"
---

# @deepseek-ai/dsh-segment

[English](README.md) | 中文

本包是 DSH 侧的 `towert.segment.v1` 边界。科学合约仍以 FLINTER
data-infra 中的 `segment-v1.schema.json` 与 `segment-capability-contract.md`
为准；本包不会复制 schema，也不会实现 segmentation。

它验证并传输顶层状态语义：`completed` 可以有零个 candidate，`partial`
必须声明缺失组件，`failed` 必须没有 candidate 和 classification。它也
保留 `UNKNOWN` 与 classifier abstention 的区别。

本包不包含模型推理、artifact 获取、Tower 权威、rubric 路由、AWS、B2、RDS、
Beam 或 storage 行为。
