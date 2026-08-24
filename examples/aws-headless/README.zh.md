# aws-headless

[English](README.md) | 中文

面向 AWS 部署线的无密钥运行时组合：`dsh-base` 加上 dsh-orca worker 桥、dsh-segment 语义面（`RUN_BASELINE_PHYSICS`）、dsh-pes 可搜索 trace 工具，以及 agentic-control 调查接缝（`run_physical_assessment`、`finish_investigation`、`stop_unknown`），并把凭据存储替换为 AWS Secrets Manager、注册休眠中 pi-ai 适配器的目录 Bedrock 路由。启动与运行时 AWS 调用为零：两个 AWS provider 都在每次请求时（而非启动时）延后到默认凭据链。

## Profile

- `profile/package.json` — `dsh.profile.bundles` 按顺序列出四个 bundle（`@deepseek-ai/dsh-base`、`@flinter/dsh-orca`、`@flinter/dsh-segment`、`@flinter/dsh-pes`）。
- `profile/cordis.patch.yml` — 在 AWS Secrets Manager 行挂载之前禁用本地凭据存储，以空的 `providers.amazon-bedrock` 配置注册 Bedrock 路由，把 dsh-pes 引擎固定到不可变 producer SHA `c05c3fc747f0aa0fcb9d0603009add71c59e091b`，使每个工具结果都在 `provenance.engine_pin` 中携带该 pin，并挂载两行 agentic-control（`@deepseek-ai/dsh-agentic-control`、`@deepseek-ai/dsh-tool-agentic-control`），使调查宏操作随 profile 一起交付。调查的 `start` 仍是特权 harness 通道；队列/lease/Fargate 重试权限不会进入该组合。

无密钥门禁（`tests/aws-headless.e2e.ts`、`tests/aws-headless.snapshot.ts`、`tests/agentic-trajectory.e2e.ts`）在剥离 AWS 环境、并由协议兼容 stub 填充引擎接缝的情况下启动并快照该组合；trajectory 门禁消费已交付的行，把一次调查驱动到记录在案的结束。

## Runtime semantic/trace E2E 驱动

`runtime-driver.js` 是云 worker 针对**真实组装后的 profile**（绝不是缩水的 fixture 配置）调用的可复用运行时任务。它只驱动两个工具，不做任何 LLM/模型决策，并在 stdout 上恰好输出一行有界、机器可读的 JSON 摘要：

- `RUN_BASELINE_PHYSICS` 仅作为**接口检查**：驱动要求诚实的 `abstention: 'prototype_stub'` 标记，并把结果报告为 stub 接口检查——绝不呈现为科学的 TowerH 成功。
- `search_events` 使用 `$PES_TRACE_TASK_ARGS` 中的确定性参数（`["--query", "...", "--n", "..."]`，否则用打包默认值）针对运行时语料（`$PES_EVENTS_ENRICHED_JSONL`）与运行时引擎（`$PES_QUERY_COMMAND`，否则 `python3 -m event_index.query`）。驱动要求 `status: completed`、`abstained: false`、有界结果（`count` 在 `[1, requested_n]` 且数组一致）、`provenance.engine_pin` 中固定的 producer 引擎 `c05c3fc747f0aa0fcb9d0603009add71c59e091b`，并且当配置了 `$PES_TRACE_*` 传输时，completed 结果的自动 trace 发射必须为 `accepted`。

生产模式绝不回退到测试 fixture 引擎：引擎接缝只解析 `$PES_QUERY_COMMAND` 或打包默认命令，不可用的引擎会以结构化 `engine-*` 失败浮出并使本次运行失败。这是 runtime semantic/trace E2E——不是科学的 TowerH 证明——摘要也明确声明（`"scientific_proof": false`）。

### 入口（data-infra 运行时需提供的调用）

```sh
node --import tsx/esm examples/aws-headless/runtime-driver.js
```

`PES_TRACE_AWS_PROFILE` 选择 profile，默认为 `aws-headless`。运行时必须提供：

| 变量 | 含义 |
|---|---|
| `DSH_HOME` | 其 `profiles/aws-headless` 为已组装 profile 的 home |
| `PES_EVENTS_ENRICHED_JSONL` | 引擎以 `--events` 读取的事件索引（必需） |
| `PES_QUERY_COMMAND` | JSON 数组形式的引擎 argv；省略则用 `python3 -m event_index.query` |
| `PES_TRACE_TASK_ARGS` | JSON 字符串数组；`--query` 和 `--n` 各最多一次，默认值为 `cup acquisition` 与 `3` |
| `PES_TRACE_AWS_PROFILE` | 组装后的 profile 名称（默认 `aws-headless`） |
| `PES_ARTIFACTS_ROOT` | 可选的 artifact 根，用于 `source_path` 校验 |
| `PES_TRACE_*` | 可选的 trace 传输与 ancestry；配置后发射必须为 `accepted` |

### 退出码

| 码 | 含义 |
|---|---|
| 0 | 通过 |
| 1 | 启动/组合或意外驱动失败 |
| 2 | 语料缺失（`$PES_EVENTS_ENRICHED_JSONL` 未设置或不存在） |
| 3 | 引擎不可用或引擎失败（`engine-*` 结构化结果） |
| 4 | 搜索 abstention |
| 5 | provenance 畸形（`engine_pin` 缺失/不匹配或信封字段缺失） |
| 6 | trace 传输失败（已配置但未 `accepted`） |
| 7 | `RUN_BASELINE_PHYSICS` 接口检查失败 |

## 无密钥进程测试

`tests/runtime-driver.e2e.ts` 把驱动作为子进程运行在真实 aws-headless Loader 之上，配以 localhost 回调接收器与确定性引擎命令，断言单行摘要与自动发射端到端行为（精确字节、`x-webhook-signature` HMAC 头部、固定的 producer SHA、确定性记录 id），然后用专门 fixture（失败引擎、abstain 引擎、未固定 pin 的 profile、500 接收器）钉住每个非零退出类别。
