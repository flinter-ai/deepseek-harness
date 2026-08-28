# Agent Note: H0 agentic-control 在已交付的 aws-headless profile 中激活

Status: implemented

[English](2026-08-24-dsh-h0-production-activation.md) | 中文

## Problem

aws-headless profile 在交付时未激活已合并的 H0 agentic-control 包：只有 P0.6 trajectory 测试注入了它们的行与 profile 本地链接，因此对断言"已交付 profile 激活了什么"的组合（composition）、启动（boot）与快照（snapshot）门禁来说，生产组合缺口不可见。

## Decision

`examples/aws-headless/profile/cordis.patch.yml` 以普通 out-of-tree 行的方式挂载两行 agentic-control（`@deepseek-ai/dsh-agentic-control`、`@deepseek-ai/dsh-tool-agentic-control`），安装路径与 Secrets Manager 行相同； H0 内核不变。trajectory 测试消费已交付的行而非注入重复行；组合门禁断言每行恰好一次，启动门禁在 `RUN_BASELINE_PHYSICS` 与 dsh-pes 工具旁断言`run_physical_assessment`、`finish_investigation` 与 `stop_unknown`。无密钥快照记录组装后的模型可见工具面。

权限边界不变：控制平面拥有工作生命周期，DSH 拥有调查轨迹，队列/lease/Fargate 重试权限不会进入该组合。`RUN_BASELINE_PHYSICS` 仍是诚实的 prototype-stub 接口检查，外部`DSH_COMMIT` 不移动。

## 备选方案

**把 H0 包声明为 profile bundle。** 否决：激活属于 profile 组合关注点；在 H0 包内添加`dsh.bundle` 清单会把部署形态塞进内核包。

**继续由 trajectory 测试注入行与链接。** 否决：trajectory 门禁会一直在证明一个已交付 profile 无法复现的测试专用组合。

## 影响

- 已交付的 aws-headless profile 激活调查接缝，无密钥组合、启动与快照门禁从物化后的 profile 证明这一点。
- trajectory 门禁保留一个位于已交付闭包之外的测试专用包：为其模型瀑布编写脚本的 llm-replay 适配器。