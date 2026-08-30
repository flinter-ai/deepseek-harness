---
description: "公开的 DSH searchable-trace 合约接缝，提供有界、租户隔离的引用。"
kind: "package-library"
---

# @deepseek-ai/dsh-pes

[English](README.md) | 中文

本包是 searchable trace record 的 DSH 侧合约接缝。权威持久化实现仍由
FLINTER data-infra 的 `searchable-trace-store` 与 `searchable-trace-service`
负责。

接缝只允许有界 summary 与不可变 artifact reference。record identity 根据
organization、investigation run 和 ordinal 确定生成。重复投递必须幂等；内容
不同则返回冲突。查询必须带 organization 边界，不能跨租户返回数据。

本包不包含数据库驱动、artifact 下载、B2/RDS 部署、AWS 状态或科学结果权威。
