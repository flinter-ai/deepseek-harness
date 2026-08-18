# Agent Note: llm-pi-ai 的 Amazon Bedrock 支持

Status: implemented

[English](2026-08-18-amazon-bedrock-support-llm-pi-ai.md) | 中文

## Problem

在 AWS 内运行的 DSH agent 需要调用 Amazon Bedrock 模型，同时不脱离 AWS 凭据链。`dsh-llm-pi-ai` 适配器此前排除了 Bedrock，因为其配置形状——`apiKeyEnv`、`baseURL` 和 headers——无法表达 SigV4 签名或 AWS region 选择。想要 Bedrock 的部署不得不在前面挡一个 OpenAI 兼容网关，既增加基础设施，又丢失 pi-ai 原生的 Bedrock 流式行为。

## Decision

### 通过现有协议表暴露 `bedrock-converse-stream`

`bedrock-converse-stream` 被加入 `PROTOCOLS` 和 `supportedProtocols()`。pi-ai catalog 已自带 `amazon-bedrock` 及当前 Bedrock 模型列表，因此最小 profile 是 `providers: { amazon-bedrock: {} }`。通过显式 `models` 列表并指定 `api: bedrock-converse-stream`，也可以手写 Bedrock 路由。

### AWS 原生凭据解析

Bedrock 凭据通过标准 AWS 凭据链解析：环境变量（`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`）、`AWS_PROFILE`、ECS 任务角色以及 web identity token。在 AWS 内部（ECS、Fargate、AgentBox），任务角色或实例 profile 自动提供凭据，因此不需要 `apiKeyEnv`。`apiKeyEnv` 仍可用于使用 `AWS_BEARER_TOKEN_BEDROCK` 的 bearer-token 部署。

### 可选的 `region` 与 `profile` profile 字段

`PiAiProviderProfile` 新增可选的 `region` 与 `profile` 字段。当模型 ARN 与环境无法决定端点时，`region` 固定 Bedrock 端点。当不应使用默认凭据链时，`profile` 选择 AWS profile。两个字段都会通过 pi-ai 的流选项传给 Bedrock provider。

## Alternatives considered

**不把 Bedrock 纳入 `llm-pi-ai`，强制使用 OpenAI 兼容网关。** 这避免改动 DSH，但会永久增加一次网络跳转、一个新的故障点，并丢失 pi-ai 原生的 Bedrock 流式与 replay state。

**给每个 provider profile 添加通用 `env` 字典。** 通用键值字典会把 provider 特定的配置泄漏到 schema 中，使校验变得不可能。具名的 `region` 与 `profile` 字段是显式且可审查的。

**把 AWS 凭据存进 DSH 的 credential store。** DSH 的 credential seam 是为 API key 设计的，不是为 AWS 这种轮换的、基于角色的凭据设计的。AWS 凭据链才是正确的权威来源；DSH 不应复制或缓存 IAM 凭据。

## Consequences

- 在 ECS/Fargate 中运行的 DSH agent 可以使用 `amazon-bedrock` 而无需任何存储凭据。
- Bearer-token Bedrock 部署仍通过 `apiKeyEnv` 支持。
- 配置 schema 现在携带两个 AWS 特定的可选字段；不影响其他 provider。
- 现有窄协议不变量保持：Vertex、Azure 和 Codex 仍被排除，因为它们的认证仍无法用受支持的配置形状表达。

## Testing

- `packages/llm/llm-pi-ai/tests/catalog.spec.ts` 覆盖协议暴露、带或不带 `region`/`profile` 的 catalog 路由解析，以及 provider 构造。
- 完整的 `llm-pi-ai` 测试套件通过（219 个测试）。
