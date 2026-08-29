# Agent Note：声明 Modelflare 的总上下文容量

Status: implemented

[English](2026-08-29-declare-modelflare-context-capacity.md) | 中文

## 问题

手工声明的 Modelflare `gpt-5.6-sol` 路由没有公布请求与响应的总上下文
容量。因此 `llm-pi-ai` 使用通用的 262,144 token 回退值，较长的已恢复会话
会在提供方使用模型更大上下文之前就被本地拒绝。

## 决策

AWS headless profile、Orca worker-home 生成器和本地部署设置中的 Modelflare
模型声明现在设置 `contextWindow: 1000000`，并声明
`reasoningEfforts.high: high`。AWS worker entrypoint 也生成相同字段。该值是
本次部署确认的提供方／模型容量。路由保持不设置 `maxTokens`；总上下文容量
与每次请求的输出预算是两个独立设置，因此输出默认值仍由提供方决定。

## 备选方案

**保留通用的 262,144 token 回退值。** 不予采用：它低估了已确认的模型容量，
并使 harness 拒绝本来可以处理的长请求。

**同时将 `maxTokens` 设置为 1,000,000。** 不予采用：`maxTokens` 控制输出，
而不是总上下文；本次改动没有确认提供方的输出上限。

**不设置模型容量，依赖提供方元数据。** 不予采用：该 endpoint 没有提供可用的
容量值，而部署侧已经确认了模型信息。

## 影响

Modelflare 请求现在可以使用声明的一百万 token 总上下文容量，UI／运行时也会
为模型公开 `high` 推理。自动压缩行为没有改变；它在判断是否需要压缩上下文时
现在会获得正确的路由容量。

## 测试

针对 AWS profile 和 worker-entrypoint 的测试会断言生成的字段。本地 headless
冒烟测试仍是实时凭据路径检查；它不证明提供方公布的容量。
