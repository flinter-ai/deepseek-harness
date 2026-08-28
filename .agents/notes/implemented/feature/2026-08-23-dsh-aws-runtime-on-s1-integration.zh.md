# Agent Note: dsh-segment 与 dsh-pes 集成进入 AWS 运行时主线

Status: implemented

[English](2026-08-23-dsh-aws-runtime-on-s1-integration.md) | 中文

## Problem

AWS 运行时组合（经 `llm-pi-ai` 的 Bedrock、AWS Secrets Manager 凭证、 agentic-control、dsh-orca worker 桥接）包含以下不可变输入提供的 segment 与 searchable-trace 能力：dsh-segment S0+S1 位于`5c67922215d18daa362f8bdf78b120f623c3f385`，searchable-trace 插件位于`9ab7deb7bce7df0c0970e29686a3f76ddf62b027`，引擎生产者位于`c05c3fc747f0aa0fcb9d0603009add71c59e091b`（flinter 研究仓库的 `feat/searchable-trace-engine`）。

## Decision

该组合仅集成上述三个不可变体，不重建引擎或 segment 运行时：

- aws-headless 组合（`examples/aws-headless`）在`dsh.profile.bundles` 中同时列出两个 bundle （base、dsh-orca、dsh-segment、dsh-pes），其 patch 将插件行的`config.engine_pin` 钉扎为引擎生产者 SHA —— 该钉扎会流入每个工具结果的`provenance.engine_pin`。组合物化（materialization）以链接 dsh-orca 的同样方式链接两个 `@flinter` 包，composition、boot 与 snapshot 门在未改动的 Bedrock/Secrets-Manager/agentic-control 行旁断言新行与工具注册。

引擎本身仍然不被导入：插件在调用时通过配置好的命令接缝 spawn 引擎，运行时引擎打包仍是集成门工作。`DSH_COMMIT`、控制平面代码、凭证以及现有 AWS 组合均未改动；未触碰任何 AWS/provider/cloud 资源；未重启旧的 20ec9d16 worker。

## 备选方案

**把当前 worker pin 当作语义运行时直接推广。** 否决：20ec9d16 worker 只证明基础设施生命周期，不证明 S1 语义能力。

**把 searchable-trace 引擎导入 DSH bundle。** 否决：插件的显式子进程接缝将 Python producer 与 DSH 包分离，并为部署打包保留不可变 producer pin。

**添加两个 bundle 时替换现有 AWS 组合。** 否决：集成必须保留 Bedrock、Secrets Manager、agentic-control 与 dsh-orca 行为；profile 只新增 segment 与 searchable-trace 两行。

## 影响

- AWS 运行时组合启动时恰好有一行 dsh-segment（`RUN_BASELINE_PHYSICS`）和一行 dsh-pes（四个工具，`engine_pin` 已钉扎）——无 key 启动零 AWS 调用，由扩展后的组合与 boot 门断言。
- R1 语义里程碑（真实 TowerH 扫描、真实结果标签、RDS `005_experience_events`、 Octen 嵌入）以及所有 cloud 语义门保持 **NOT_RUN**；任何声称相反的说法都是错的。
