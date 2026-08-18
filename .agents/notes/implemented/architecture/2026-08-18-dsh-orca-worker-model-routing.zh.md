# Agent Note: DSH-Orca worker 模型路由

Status: implemented

[English](2026-08-18-dsh-orca-worker-model-routing.md) | 中文

## Problem

`examples/dsh-orca/` 桥接把 DeepSeek Harness（DSH）agent 变成 Orca 编排的 worker。worker home 选定一个主模型，启动器把任务委托给它。模型失败是常态：provider 配额、余额耗尽、临时 HTTP 错误以及传输层流式失败都会发生在真实网关上。如果没有声明 fallback，每次失败都需要手动重新 dispatch，并且要重新创建 worker terminal。

同时，路由策略不能捏造 provider 身份或拼接 model id。像 `opencode-go` 这样的网关可能托管使用不同 wire protocol 的模型，而 harness 当前的 pi-ai adapter 在 provider 级别选择协议。需要不同协议的模型不能通过重命名 provider 来强行通过。

## Decision

### 固定期望路由并保留运营 fallback

`examples/dsh-orca/worker-home.mjs` 声明了一个封闭路由表：

- `easy` 主路由：`opencode-go / gpt-5.6-luna`。
- `easy-backup` 与 `backup`：`gmi-serving / deepseek-ai/DeepSeek-V4-Flash-0731`。
- `hard` 与 `kimi`：`kimi-coding / k3-256k`。
- `hard-backup` 与 `glm-5.3`：`opencode-go / glm-5.3`。

`dsh-agent.mjs` 在主模型因 eligible provider 或 transport 错误失败时，会用配置好的 fallback 重试一次。`easy` 回退到 `easy-backup`；`hard` 回退到 `hard-backup`。这次回退不是路由变更，而是主路由不可用时执行的操作措施。

### gpt-5.6-luna 保持为主模型并标记 BLOCKED

`gpt-5.6-luna` 被配置为 `easy` 主模型，并以真实 card 值列入 `opencode-go` 显式模型目录。`BLOCKED` 注释说明它只在 OpenAI Responses API 上能正常结束，而 `opencode-go` 被固定为 OpenAI chat/completions，以便 `glm-5.3` 和其他显式模型工作。DSH pi-ai 当前在 provider 级别选择 `api`，因此单个 `opencode-go` provider 不能混合两种协议。

所以第一次 `easy` 尝试会以 transport/finish-reason 错误失败，fallback classifier 会用 `easy-backup` 重试，任务最终由 GMI-serving 完成。期望路由保持明确；fallback 只是临时措施，直到 DSH 侧能力支持按模型选择协议。

### Fallback 资格 classifier

当捕获的输出包含以下内容时，失败具备 fallback 资格：

- quota、balance、credit 或 authorization 错误；
- HTTP 信号 `429` 或 `404`；
- unsupported-model 或 invalid-model 错误；
- transport 失败，例如 `stream ended`、`finish_reason` 或 `transport`。

`NO_ADAPTER` 和本地配置错误被刻意排除在 fallback 资格之外。对缺失的 adapter 或损坏的本地配置换用不同 model id 重试不会成功，只会延迟报告真正的问题。

## Alternatives considered

**把 `easy` 切换为 GMI-serving 作为运营主路由。** 这能立刻让测试通过，但会掩盖期望路由，使 fallback 成为事实上的策略。路由表记录意图；fallback 执行例外。

**创建伪 provider 如 `opencode-go-responses`。** 已尝试并回退。provider 身份与 wire protocol 是两个独立关注点，捏造 provider 名称会把协议选择泄露到 provider 命名空间。

**在 DSH 支持前从目录中移除 `gpt-5.6-luna`。** 这也会掩盖期望状态，使路由表变得不可解释。保留该模型条目并附加 `BLOCKED` 注释，能让约束可见且可被搜索。

**不加区分地重试所有失败。** 对 `NO_ADAPTER` 或 `settings.yaml` 语法错误重试没有帮助，还会在明显是本地配置错误的情况下浪费 provider 预算。

## Consequences

- 期望路由稳定可见，记录在 `worker-home.mjs` 和 `README.md` 中。
- 在 DSH 支持按模型 `api` 选择之前，使用 `--model easy` 分派的操作任务会通过 `easy-backup` 完成。
- fallback classifier 由 `examples/dsh-orca/tests/classifier.spec.ts` 中的单元测试守护。
- 没有捏造任何 provider 身份；`opencode-go` 仍是一个 provider，只使用一种显式协议。
