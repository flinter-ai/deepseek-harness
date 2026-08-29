# Agent Note：重试 pi-ai 的暂时不可用失败

Status: implemented

[English](2026-08-29-retry-transient-pi-ai-unavailability.md) | 中文

## 问题

部分 pi-ai 提供方会丢弃暂时故障的 HTTP 状态，只发出类似
`The model service is temporarily unavailable. Please try again later.` 的文本。
适配器将该文本归类为 `PI_AI_ERROR`，而它不在默认的有界重试集合中，因此可恢复
的提供方故障会直接结束 agent step。

## 决策

pi-ai stream classifier 会把明确的暂时不可用文案——暂时或当前不可用、服务不可用、
后端／服务器繁忙或过载，以及 `try again later`——映射为现有的 `SERVER` code。
认证、配额、限流、无效请求、超时、上下文溢出和传输模式仍保持原有优先级。不新增
pi-ai SDK 重试；现有 `dsh-llm-retry` 策略仍是唯一持久化重试所有者。

## 备选方案

**重试每个 `PI_AI_ERROR`。** 不予采用：通用 code 也涵盖可能永久存在的提供方故障，
或格式错误的请求。

**添加提供方专用的 always-retry 策略。** 不予采用：无限重试可能在持续故障时循环，
也会把识别常见提供方错误文案的责任放入部署配置。

**依赖提供方保留 HTTP 状态。** 不予采用：观察到的 pi-ai error event 没有保留状态，
而适配器无法在 pi-ai 展平错误后恢复它。

## 影响

已知的暂时不可用故障现在进入常规有界重试路径（默认两次重试，带指数退避和抖动）。
未知故障仍以 `PI_AI_ERROR` 呈现，不会自动重试。直接的 `ctx.llm.stream()` 仍只发起
一次提供方请求；持久化 agent-step 恢复继续负责重试。

## 测试

pi-ai 转换测试覆盖观察到的 Modelflare 文案和后端过载变体。现有重试策略测试继续证明
默认策略会重试 `SERVER`。
