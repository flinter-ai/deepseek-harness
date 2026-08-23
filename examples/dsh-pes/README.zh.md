# @flinter/dsh-pes

[English](README.md) | 中文

**可搜索轨迹插件**（searchable-trace plugin）：为 DeepSeek Harness 提供四个原生 Agent 工具，基于可搜索轨迹事件索引——

| 工具 | 引擎模式 | 用途 |
|---|---|---|
| `search_events` | `search` | 对所有已索引事件做自然语言查询 |
| `find_similar_states` | `similar` | 查找前状态匹配某个物理状态的事件 |
| `find_counterfactuals` | `counterfactual` | 查找起始状态相似但结局不同（different outcome）的事件 |
| `zoom` | `zoom` | 查看单个 episode 内与某个帧窗口重叠的全部事件 |

引擎是 producer 切片中的 `event_index.query` JSON-lines CLI
（[flinter-ai/flinter-common `feat/searchable-trace-engine`](https://github.com/flinter-ai/flinter-common)，
不可变 SHA `c05c3fc747f0aa0fcb9d0603009add71c59e091b`）。本插件在运行时**绝不**导入引擎包或任何兄弟 checkout：它通过**显式配置的 command 接缝**spawn 该 CLI，并按其文档化的 stdin JSONL 协议通信（每行一个请求对象 → 每行一个响应对象）。插件是一个 bundle（`dsh.bundle.patch` → `cordis.patch.yml`），headless profile 会将其作为一行与其它 bundle 一起发现并挂载。

## 范围（本插件证明了什么）

- 四个已注册工具，带稳定、有界的 schema：结果数 `n` 被钳制到 `MAX_RESULT_N`（50）和语料大小；状态数组、文本字段、引擎 stdout/stderr 全都有界。
- 显式引擎接缝：`config.command`（argv，不含 mode）——否则 `$PES_QUERY_COMMAND`（JSON 数组）——否则打包默认值 `['python3', '-m', 'event_index.query']`。事件索引来自 `config.events`，否则 `$PES_EVENTS_ENRICHED_JSONL`；每次调用都会显式以 `--events PATH` 传入，绝不从 cwd 猜测。
- 结构化结果**保留引擎的失败面**而非隐藏它：每个结果都是有界的信封，带 `provenance`（插件 + 引擎协议 + 可选的不可变 `engine_pin`），并且事件的逐事件 provenance（`provenance` / `verification` / `outcome_source`）原样透传。引擎的诚实弃权（`abstained: true`）映射为 `status: 'abstained'`，绝不当作错误。引擎失败映射为稳定的 `error.kind`：

  | kind | 含义 |
  |---|---|
  | `malformed-input` | schema 合法但语义非法的参数（插件侧），或引擎逐请求拒绝 |
  | `engine-timeout` | 配置的子进程超时到期 |
  | `engine-nonzero-exit` | 引擎非零退出且无可解析的错误响应（保留 stderr） |
  | `engine-malformed-response` | stdout 违反一请求一响应协议 |
  | `engine-unavailable` | 命令无法启动，或未配置事件索引 |
  | `artifact-reference-missing` | 返回事件的 `source_path` 在 `config.artifactsRoot` 下无法解析（fail-closed） |

- 工件引用：配置 `config.artifactsRoot`（否则 `$PES_ARTIFACTS_ROOT`）后，每个返回事件的 `source_path` 必须能解析到该根目录下存在的文件；缺失引用会让整次调用 fail loud。`artifact_verification` 报告 `verified` / `unconfigured`。
- 无钥 worker 启动 → Loader → 工具面 → 引擎 command 接缝路径：测试不接触引擎包、实时 provider 或网络（fixture stub 按文档协议重新实现）。
- 运行时自有的自动发射：每次 COMPLETED（非 abstained）结果之后，插件把结果/provenance 映射进已提交的 CP 可搜索轨迹线上记录，并把精确签名字节 POST 到运行时配置的回调 URL——这是 producer 副作用，绝不是工具。

## 引擎接缝（部署前请先读）

```js
// config.command is the full argv WITHOUT --events and WITHOUT a mode;
// the plugin appends --events <resolved-path> itself.
config: {
  command: ['python3', '-m', 'event_index.query'],
  events: '/data/events.enriched.jsonl',       // else $PES_EVENTS_ENRICHED_JSONL
  timeout_ms: 30_000,                           // validated int in [1, 120_000]
  artifacts_root: '/data/artifacts',            // optional artifact root
  engine_pin: 'c05c3fc747f0aa0fcb9d0603009add71c59e091b', // optional producer pin
}
```

## 运行时自有的可搜索轨迹发射器（改动前请先读）

本插件同时也是已提交 CP 可搜索轨迹投影的自动 producer（`trace.js` + `trace-record.js`）：在 completed（非 abstained）dsh-pes 结果之后，它把结果及其 provenance 确定性地映射进 CP 线上记录，并把精确字节 POST 到运行时配置的回调 URL。它明确**不是**工具，不注册任何模型可见的东西，也永远不能选择或观察到自己的目标地址。

- **线上记录（`trace-record.js`，纯接缝）。** 规范键序 `organizationId, projectId, episodeId, jobId, irId, jobOutputId, artifactId, runOrdinal, traceKind, summaryText, producerSha, schemaVersion, id`，紧凑 JSON。`traceKind` 是被调用的工具名；`summaryText` 是有界（≤ 2000 字符）的确定性投影；`producerSha` 是 `config.engine_pin`，否则是已提交的引擎 commit `c05c3fc…`（永远是**引擎** commit，绝不是 AWS 运行时修订）；`id` 是 `tr_<sha256(organizationId:irId:runOrdinal)>` 的前 24 个十六进制字符，与已提交的 CP 推导一致，因此 CP 重放是幂等的。
- **传输归属。** 回调 URL 与 HMAC 密钥只通过经过校验的插件配置或 `PES_TRACE_*` 环境到达——绝不通过工具/模型请求字段。只配置 URL/密钥中的任一个，或在未配置 ancestry 字段时开启传输，都会在加载时 fail loud；两者都缺则发射器保持禁用。
- **签名。** 对精确 JSON 请求体字节做 HMAC-SHA256，头部 `x-dsh-signature` 小写十六进制（T1 CP producer 接缝选定的约定）。序列化器/签名器是纯函数，因此 T1/T2 字节等价性可以在不导入控制平面包或兄弟仓库的情况下测试。
- **诚实的语义。** 发射在进程内对每个不同的 completed 结果至多一次（相同重复报告 `duplicate`，绝不重复 POST）；abstained/error 结果绝不发射——已提交的 trace 契约没有为它们定义 traceKind。传输失败被分类——accepted（2xx）、validation-rejected（400）、unauthorized（401）、conflict（409）、rejected（其它 4xx）、unavailable（5xx/503）、unreachable（网络）、unexpected——并且绝不改变或失败科学结果。密钥与签名永不打印或持久化。

| config | env | 默认 | 含义 |
|---|---|---|---|
| `trace_callback_url` | `PES_TRACE_CALLBACK_URL` | — | 回调 URL（仅 http/https） |
| `trace_hmac_secret` | `PES_TRACE_HMAC_SECRET` | — | HMAC 密钥（永不打印/持久化） |
| `trace_organization_id` | `PES_TRACE_ORGANIZATION_ID` | — | ancestry：组织 |
| `trace_project_id` | `PES_TRACE_PROJECT_ID` | — | ancestry：项目 |
| `trace_episode_id` | `PES_TRACE_EPISODE_ID` | — | ancestry：episode |
| `trace_job_id` | `PES_TRACE_JOB_ID` | — | ancestry：job |
| `trace_ir_id` | `PES_TRACE_IR_ID` | — | ancestry：调查 run |
| `trace_job_output_id` | `PES_TRACE_JOB_OUTPUT_ID` | — | ancestry：job output（结果权威） |
| `trace_artifact_id` | `PES_TRACE_ARTIFACT_ID` | — | ancestry：承载完整 payload 的 artifact |
| `trace_run_ordinal_base` | `PES_TRACE_RUN_ORDINAL_BASE` | `0` | 首个发射的 run ordinal |
| `trace_post_timeout_ms` | `PES_TRACE_POST_TIMEOUT_MS` | `10000` | POST 截止（校验 int in [1, 60000]） |

## 集成 gate（NOT_RUN —— 不由本 PR 完成）

- **运行时引擎打包**：让 `python3 -m event_index.query` 在部署时可导入（包含 `event_index` 包及其数据文件的 wheel/镜像层）属于部署工作，不是本插件 PR。在此之前，无法导入的引擎会以结构化 `engine-nonzero-exit` / `engine-unavailable` 结果呈现——绝不是一个静默的空答案。
- **不可变 producer 钉扎**：引擎 producer SHA `c05c3fc747f0aa0fcb9d0603009add71c59e091b` 在此作为 provenance 文档记录；部署通过 `config.engine_pin` 钉扎，它会流入每个结果的 `provenance.engine_pin`。钉扎由打包环节落实，不由本 PR。
- **真实后端**：真实 TowerH 扫描、真实结局标签、RDS `005_experience_events`、Octen embeddings，以及任何 AWS/provider 资源仍为 NOT_RUN（见 producer roadmap）。
- **真实 CP 路由**：向真实 `/webhooks/dsh-worker/trace` 路由（T1 producer 接缝）、真实 Postgres FK ancestry 以及任何云资源的投递在本 PR 中仍为 NOT_RUN；发射器的 localhost receiver 与分类状态是本地证据。本线不改动 `flinter/aws-runtime`、`DSH_COMMIT`、控制平面代码或凭据。

## 加载与测试

headless profile 按 `dsh.profile.bundles` 顺序叠加 bundle；把 `@flinter/dsh-pes` 加入该列表即可通过 `cordis.patch.yml` 挂载插件。在本仓库中，该组合由 `tests/loader.spec.ts` 对着真实 bundle patch 校验，引擎接缝与结构化错误分类由 `tests/seam.spec.ts` 钉住，结构化结果契约由 `tests/contract.spec.ts` 钉住，插件端到端启动由 `tests/keyless-smoke.e2e.ts` 验证。运行时自有的发射器——规范字节/签名、传输归属、至多一次的重复/重试、400/401/409/503 分类、abstained/error 结果不发射——由 `tests/trace.spec.ts` 钉住；contract 与 smoke driver 还会启动 localhost receiver，端到端断言自动发射（每个不同的 completed 结果一条记录，精确请求体 + HMAC）。

```sh
# From the worktree, after pnpm install:
pnpm exec vitest run examples/dsh-pes/tests/loader.spec.ts examples/dsh-pes/tests/seam.spec.ts examples/dsh-pes/tests/contract.spec.ts examples/dsh-pes/tests/trace.spec.ts
pnpm exec vitest run --config vitest.e2e.config.ts examples/dsh-pes/tests/keyless-smoke.e2e.ts
# The same suites against built lib/ (as CI runs them):
DSH_EXAMPLE_MODE=lib pnpm exec vitest run examples/dsh-pes/tests/loader.spec.ts examples/dsh-pes/tests/seam.spec.ts examples/dsh-pes/tests/contract.spec.ts examples/dsh-pes/tests/trace.spec.ts
DSH_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.e2e.config.ts examples/dsh-pes/tests/keyless-smoke.e2e.ts
```

## 设计不变量（改动前请先读）

- 引擎只能通过配置的 command 接缝（`engine.js`）到达：运行时绝不导入 `event_index`、兄弟 checkout 或可变分支。
- 结果永远是有界的结构化信封——completed 调用仍可能是 `abstained`；每个引擎失败都变成结构化 `error` 结果，绝不抛错或返回"空但成功"的答案。
- 边界活在插件（`query.js`）里，而不只在 schema：支持的 schema 子集没有数值/字符串长度关键字，所以 `n`、状态数组大小、文本长度在任何 spawn 之前都会做语义校验。
- 误配置在加载时 fail loud（`config.command`、`timeout_ms`），或在调用时呈现为 `engine-unavailable`（缺事件索引）——绝不停默。
- trace 发射器是运行时自有的：传输与 ancestry 只来自经过校验的配置或 `PES_TRACE_*` 环境；发射绝不改变或失败工具结果，只对 completed 结果发射，并在进程内对每个不同的结果至多一次。
- 只注册已实现的工具：恰好上面四个名字；没有幻影表面。
