# Agent Note: pi-ai provider 的按模型 API 选择

Status: proposed

[English](2026-08-18-per-model-api-selection-pi-ai.md) | 中文

## Problem

`dsh-llm-pi-ai` 当前在 provider 级别选择 wire protocol。一个如 `opencode-go` 的 profile 只能指定一个 `api` 值——目前是 `openai-completions`——该路由上的所有模型都使用这个协议。当网关每个 provider 只暴露一种协议时这是正确的，但当单个网关混合多种协议时就会失败。

鲜活的例子是 `opencode-go`：

- `gpt-5.6-luna` 只在 OpenAI Responses API 上能正常结束。
- `glm-5.3`、`kimi-k3` 和 `kimi-k2.7-code` 使用 OpenAI chat/completions。

因为路由只能固定一种协议，`examples/dsh-orca/` 把 `gpt-5.6-luna` 保留为期望的 `easy` 主模型，并在 Luna 失败时依赖到 `gmi-serving` 的运营 fallback。这是 workaround，不是解决方案。

另一个独立诊断还显示，配置声明的 provider 使用 `api: openai-responses` 时会失败并报告 `NO_ADAPTER: no adapter registered for provider`，尽管 pi-ai 的协议表列出了 `openai-responses`。因此 config-declared provider 的 Responses adapter 路径需要先诊断，然后才能评估按模型选择协议。

## Proposal

### 步骤 1 — 诊断 `openai-responses` 的 NO_ADAPTER 路径

调查为何手写的 `llm-pi-ai` provider 配置 `api: openai-responses` 时无法注册 adapter，而 `openai-completions` 可以。可能的起点：

- `packages/llm/llm-pi-ai/src/provider.ts` —— `buildProvider` 与 `PROTOCOLS` 表。
- `packages/llm/llm-pi-ai/src/config.ts` —— `assertServiceable` 与围绕配置 `api` 的模型解析。
- `packages/llm/llm/src/index.ts` —— adapter 注册与 `NO_ADAPTER` 抛出点。

验收标准：一个隔离的 DSH home，其中 config-declared `opencode-go` 路由使用 `api: openai-responses` 和 `gpt-5.6-luna`，至少能到达网络 I/O 并以 provider/model 错误失败，而不是 `NO_ADAPTER`。

### 步骤 2 — 评估按模型 `api` 覆盖

如果 Responses adapter 路径健康，评估让一个 provider 路由托管混合协议的最小改动：

- 允许在显式 `models` 列表和 `modelOverrides` 中设置 `model.api`。
- 将每个模型的生效协议解析为 `model.api ?? provider.api`。
- 确保 `buildProvider` 和 `resolveRouteModels` 能处理模型不全部共享同一协议的路由。
- 对不兼容的 `compat` 开关按模型拒绝，保留现有诊断（例如 reasoning-format 开关只在 `openai-completions` 上有效）。

如果 Responses adapter 路径不健康，先修复它；不要在坏掉的 adapter 注册之上叠加按模型选择协议。

### 步骤 3 — 验证 Orca 示例路由

支持按模型 `api` 后，更新 `examples/dsh-orca/worker-home.mjs`：

- 将 `gpt-5.6-luna` 的模型条目设为 `api: openai-responses`。
- 保持 `opencode-go` 路由默认固定为 `openai-completions`。
- 验证 `easy` 能直接成功，不再需要 `easy-backup` fallback。

## Alternatives considered

**无限期保留运营 fallback。** Fallback 能工作，但每个 `easy` 任务都要消耗两次 provider 调用和一次失败。它还会向阅读路由表的用户隐藏真正的能力不匹配。

**把 `gpt-5.6-luna` 拆成独立 provider 路由。** 已尝试为 `opencode-go-responses` 并被否决：provider 身份应反映上游网关，而不是 wire protocol。为一个网关设置两条路由还会重复 credentials、headers 和 base URL 配置。

**让 provider 根据 model id 动态检测协议。** 检测启发式很脆弱，网关目录变更时会静默出错。显式 `api` 字段会大声失败，并且能在 `settings.yaml` 中审查。

**改用 pi-ai 的安装目录而不是显式模型。** pi-ai 为 `opencode-go` 的安装目录不包含我们需要的所有模型，而显式列表正是让 `glm-5.3` 今天可调用的原因。放弃显式模型是一种倒退。

## Acceptance criteria

- 配置声明的 provider 使用 `api: openai-responses` 时能注册 adapter 并到达网络 I/O。
- `model.api ?? provider.api` 能解析路由上每个模型的生效协议。
- 单个 provider 路由可以混合 `openai-completions` 和 `openai-responses` 模型。
- `examples/dsh-orca/` 的 `easy` 直接通过 `opencode-go / gpt-5.6-luna` 路由成功，不再 fallback。
- `opencode-go` 上现有的 `glm-5.3` 和 `kimi-*` 调用继续使用 `openai-completions`。

## Risks

- `openai-responses` 的 NO_ADAPTER 错误可能比亚注册更深（例如 provider 构造、schema 校验或懒加载）。可能没有快速修复。
- 按模型协议选择扩大了配置面和测试矩阵；每个混合协议路由都需要覆盖。
- `compat` reasoning 开关只在 `openai-completions` 上有效；解析器必须继续拒绝无效的按模型组合，而不是静默跳过。
- Provider 级发现（`GET /v1/models`）是协议相关的；混合路由可能需要按协议发现或手工维护模型列表。
