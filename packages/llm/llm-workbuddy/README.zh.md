---
description: "面向 DSH 用户和维护者、用于配置 workbuddy 路由的本地 WorkBuddy2API OpenAI 兼容提供方适配器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-workbuddy

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-llm-workbuddy` 是 harness LLM 服务的本地 WorkBuddy2API 适配器：它通过共享的 `llm-pi-ai` OpenAI Completions 传输注册 `workbuddy` 路由，并暴露独立网关的固定模型目录。它从配置解析端点和凭据引用，但不包含、启动或管理网关进程。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

当组合需要通过 harness LLM 服务把模型请求路由到独立管理的 WorkBuddy2API 网关时挂载此包。

### 配置路由

适配器默认使用回环端点和 `WORKBUDDY_API_KEY`；当网关部署需要不同连接信息时，可设置 `baseURL`、`apiKeyEnv`、`displayName` 或 `models`。

```yaml
- name: '@deepseek-ai/dsh-llm-workbuddy'
  config:
    baseURL: http://127.0.0.1:8000/v1
    apiKeyEnv: WORKBUDDY_API_KEY
    models:
      - id: deepseek-v4-flash
        reasoningEfforts:
          off: none
          high: high
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `displayName` | `workbuddy2api` | 提供方选择器显示的名称 |
| `apiKeyEnv` | `WORKBUDDY_API_KEY` | 为网关请求解析的凭据引用 |
| `baseURL` | `http://127.0.0.1:8000/v1` | OpenAI 兼容网关端点 |
| `models` | 固定 WorkBuddy 快照 | 提供时替换公布的模型目录 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-llm-workbuddy)是所有字段和默认值的完整来源。

### 网关边界

适配器负责路由注册和请求 profile 构造；独立的 `/Users/oldap/workbuddy2api` 网关负责提供方凭据、上游可用性和实际 HTTP 服务。

<a id="understand-the-implementation"></a>
## 理解实现

包会使用 OpenAI Completions 协议构造 `PiAiProviderProfile`，解析配置的模型列表或固定目录，并交由共享 pi-ai 适配器处理流式传输、重试策略和凭据 seam。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 包入口和提供方注册 |
| [`src/config.ts`](src/config.ts) | 配置 schema 和 profile 构造 |
| [`src/catalog.ts`](src/catalog.ts) | 固定模型目录和推理能力 |
| [`src/invariant.ts`](src/invariant.ts) | 路由和目录行为的包级不变量 |

<a id="further-exploration"></a>
## 延伸阅读

当包级契约不足以回答问题时，可阅读以下页面。

- [llm-pi-ai 适配器](../llm-pi-ai/README.zh.md) — 共享的 OpenAI Completions 传输、凭据、流式处理和重试策略。
- [dsh-llm 服务](../llm/README.zh.md) — 注册该路由的提供方无关服务。
- [WorkBuddy 网关交接](../../../LOCAL-LLM-API-HANDOFF.md) — 本地网关归属和运行说明（若当前 checkout 包含该文件）。

<a id="model-experience"></a>
## 模型体验

### WorkBuddy 请求

#### 模型看到的内容

选定的 WorkBuddy 模型会收到 harness 系统提示、消息历史、工具 schema 和由共享 OpenAI Completions 传输转换的请求选项；适配器不会额外添加提示文案。

#### Token 影响

上游 WorkBuddy 网关决定分词和用量报告；固定目录描述模型身份和推理能力，但不估算提供方计费。

#### KV Cache 影响

缓存前缀由网关负责，因此改变选定的 `model`、提示历史、工具或请求选项可能改变缓存域或可复用前缀。

### WorkBuddy 响应

#### 模型看到的内容

提供方文本、推理、工具调用、用量和结束事件由 `llm-pi-ai` 转换为 harness 流协议，并且只有在 session loop 记录后才成为持久化上下文。

#### Token 影响

输入和输出用量仍由提供方负责；适配器不会改写网关的计量结果。

#### KV Cache 影响

记录的响应内容会追加到后续请求，而传输元数据和用量记录本身不会改变模型可见前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **模型目录是固定快照** — 独立网关支持的模型变化时更新 `src/catalog.ts`。
- **网关是外部服务** — 此包不会启动、健康检查或故障转移 `/Users/oldap/workbuddy2api`。
- **默认端点仅限回环地址** — 远程或其他绑定端点需要显式配置 `baseURL`，并单独进行安全评估。
- **适配器不新增图片能力** — 图片支持取决于共享传输和网关自身契约。

<a id="dev-note"></a>
### 开发备注

开发备注是非权威的维护上下文；已发布行为由包代码、生成的配置目录、测试和上文各节定义。

- 将网关凭据保留在仓库之外，并通过 `apiKeyEnv` 引用。
- 把目录更新视为契约变更，同时更新聚焦测试和双语 README。
