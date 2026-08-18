# Agent Note: pi-ai provider 的按模型 API 选择

Status: implemented

[English](2026-08-18-per-model-api-selection-pi-ai.md) | 中文

## Problem

`dsh-llm-pi-ai` 在 provider 级别选择 wire protocol。一个如 `opencode-go` 的 profile 只能指定一个 `api` 值，该路由上的所有模型都使用这个协议。当单个网关混合多种协议时就会失败。

鲜活的例子是 `opencode-go`：

- `gpt-5.6-luna` 只在 OpenAI Responses API 上能正常结束。
- `glm-5.3`、`kimi-k3` 和 `kimi-k2.7-code` 使用 OpenAI chat/completions。

因为路由只能固定一种协议，`examples/dsh-orca/` 把 `gpt-5.6-luna` 保留为期望的 `easy` 主模型，并在 Luna 失败时依赖到 `gmi-serving` 的运营 fallback。这个 workaround 让每个 `easy` 任务都消耗两次 provider 调用和一次失败。

## Decision

### 按模型 `api` 覆盖

`PiAiModelProfile` 和对应的 `modelFields` schema 现在接受可选的 `api` 字段，用于指定支持的 wire protocol。`resolveRouteModels` 将每个模型的生效协议解析为 `entry.api ?? request.api ?? base?.api ?? routeApi`。

`buildProvider` 检查解析后的模型。当所有模型使用同一协议时，仍用单个 `ProviderStreams` 实现构造 provider。当路由混合协议时，构造一个以 `model.api` 为键的 `Partial<Record<string, ProviderStreams>>` 映射，并交给 pi-ai 的 `createProvider`，后者将每个请求分派到该模型 `api` 对应的实现。

路由级 `api` 保持默认值，校验顺序不变：显式指定的路由协议若本构建不支持，仍会在考虑按模型覆盖之前失败。

### `examples/dsh-orca` 路由恢复

`examples/dsh-orca/worker-home.mjs` 在 `opencode-go` 路由上将 `gpt-5.6-luna` 声明为 `api: openai-responses`，而路由本身保持 `api: openai-completions`。因此 `easy` worker 直接通过 Luna 路由，不再 fallback 到 GMI-serving。

fallback classifier 和 `easy-backup` / `hard-backup` 路由保留，用于真正的 provider 失败（配额、404、未授权、transport 错误）。

## Alternatives considered

**无限期保留运营 fallback。** Fallback 能工作，但每个 `easy` 任务都要消耗两次 provider 调用和一次失败，还会向阅读路由表的用户隐藏能力不匹配。

**把 `gpt-5.6-luna` 拆成独立 provider 路由。** 已尝试为 `opencode-go-responses` 并被否决：provider 身份应反映上游网关，而不是 wire protocol。为一个网关设置两条路由还会重复 credentials、headers 和 base URL 配置。

**让 provider 根据 model id 动态检测协议。** 检测启发式很脆弱，网关目录变更时会静默出错。显式 `api` 字段会大声失败，并且能在 `settings.yaml` 中审查。

**改用 pi-ai 的安装目录而不是显式模型。** pi-ai 为 `opencode-go` 的安装目录不包含我们需要的所有模型，而显式列表正是让 `glm-5.3` 可调用的原因。放弃显式模型是一种倒退。

## Consequences

- 单个 provider 路由可以混合 `openai-completions`、`openai-responses` 和 `anthropic-messages` 模型，每个模型用自己的 `api` 声明。
- `examples/dsh-orca` 的 `easy` 直接通过 `opencode-go / gpt-5.6-luna` 路由；验收测试无需 fallback 即可完成。
- 现有单协议路由行为不变，因为 `model.api` 是可选的，路由级 `api` 仍是默认值。
- `compat` reasoning 开关只在 `openai-completions` 模型上有效；`resolveModelCompat` 已按模型校验。

## Testing

- `packages/llm/llm-pi-ai/tests/` 通过（216 个测试），包括现有 catalog 和 adapter 套件。
- 一个隔离的 DSH home，其中 `opencode-go` 声明为 `api: openai-completions` 且 `gpt-5.6-luna` 为 `api: openai-responses`，能到达网络 I/O 并直接完成 prompt。
- `examples/dsh-orca` 验收运行 `run_5089c98e6e15` 使用 `--model easy` 分派，直接执行 Luna，并返回 `worker_done(succeeded)`。
