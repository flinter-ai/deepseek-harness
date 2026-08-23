# Agent Note: dsh-segment 与 dsh-pes 集成进入 AWS 运行时主线

Status: implemented

[English](2026-08-23-dsh-aws-runtime-on-s1-integration.md) | 中文

## Problem

AWS 运行时主线（`flinter/aws-runtime`：经 `llm-pi-ai` 的 Bedrock、AWS Secrets
Manager 凭证、agentic-control、dsh-orca worker 桥接）没有 segment 或
searchable-trace 表面。两个插件都仅存在于独立的不可变输入中：dsh-segment
S0+S1 位于 `5c67922215d18daa362f8bdf78b120f623c3f385`，searchable-trace 插件位于
`9ab7deb7bce7df0c0970e29686a3f76ddf62b027`，引擎生产者位于
`c05c3fc747f0aa0fcb9d0603009add71c59e091b`
（flinter 研究仓库的 `feat/searchable-trace-engine`）。生产者 SHA 只是作为
provenance 文档被记录，没有任何组合将其钉扎。

## Decision

从 `flinter/aws-runtime`（`24215f21c1`）创建分支 `integration/aws-runtime-on-s1`，
仅集成上述三个不可变体，不重建引擎或 segment 运行时：

- 合并提交 1（`8987c4981a`）：dsh-segment S0+S1 位于 `5c67922215`。
- 合并提交 2（`70aaf1f6ab`）：searchable-trace 插件位于 `9ab7deb7bc`。
- 组合接线：aws-headless 组合（`examples/aws-headless`）现在在
  `dsh.profile.bundles` 中同时列出两个 bundle
  （base、dsh-orca、dsh-segment、dsh-pes），其 patch 将插件行的
  `config.engine_pin` 钉扎为引擎生产者 SHA —— 该钉扎接缝会流入每个工具结果的
  `provenance.engine_pin`（由插件的 seam spec 覆盖）。组合物化（materialization）
  以链接 dsh-orca 的同样方式链接两个 `@flinter` 包，composition/boot 门在未改动的
  Bedrock/Secrets-Manager/agentic-control 行旁断言新行与工具注册。

引擎本身仍然不被导入：插件在调用时通过配置好的命令接缝 spawn 引擎，运行时引擎
打包仍是集成门工作。`DSH_COMMIT`、控制平面代码、凭证以及现有 AWS 组合均未改动；
未触碰任何 AWS/provider/cloud 资源；未重启旧的 20ec9d16 worker。

提交通过工作区本地 git store（`/private/tmp/flinter-aws-r1-git`）产生，因为该
worktree 的 git-dir（`/Users/oldap/finter/deepseek-harness/.git/…`）在本会话中拒绝
一切写入且不存在升级通道；提交集与 worktree 本应产生的完全一致（父提交与树相同）。

## 影响

- AWS 运行时组合启动时恰好有一行 dsh-segment（`RUN_BASELINE_PHYSICS`）和一行
  dsh-pes（四个工具，`engine_pin` 已钉扎）——无 key 启动零 AWS 调用，由扩展后的
  组合与 boot 门断言。
- R1 语义里程碑（真实 TowerH 扫描、真实结果标签、RDS `005_experience_events`、
  Octen 嵌入）以及所有 cloud 语义门保持 **NOT_RUN**；任何声称相反的说法都是错的。
- 在 git-dir 可写时重新执行 `git push` 即可发布
  `integration/aws-runtime-on-s1`；`/private/tmp/flinter-aws-r1` 的工作树已是
  完全合并后的内容。