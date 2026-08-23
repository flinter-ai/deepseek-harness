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

## 集成 gate（NOT_RUN —— 不由本 PR 完成）

- **运行时引擎打包**：让 `python3 -m event_index.query` 在部署时可导入（包含 `event_index` 包及其数据文件的 wheel/镜像层）属于部署工作，不是本插件 PR。在此之前，无法导入的引擎会以结构化 `engine-nonzero-exit` / `engine-unavailable` 结果呈现——绝不是一个静默的空答案。
- **不可变 producer 钉扎**：引擎 producer SHA `c05c3fc747f0aa0fcb9d0603009add71c59e091b` 在此作为 provenance 文档记录；部署通过 `config.engine_pin` 钉扎，它会流入每个结果的 `provenance.engine_pin`。钉扎由打包环节落实，不由本 PR。
- **真实后端**：真实 TowerH 扫描、真实结局标签、RDS `005_experience_events`、Octen embeddings，以及任何 AWS/provider 资源仍为 NOT_RUN（见 producer roadmap）。
- 不修改 `flinter/aws-runtime`、`DSH_COMMIT`、控制平面代码或凭据；不把本线合并进 aws-runtime。

## 加载与测试

headless profile 按 `dsh.profile.bundles` 顺序叠加 bundle；把 `@flinter/dsh-pes` 加入该列表即可通过 `cordis.patch.yml` 挂载插件。在本仓库中，该组合由 `tests/loader.spec.ts` 对着真实 bundle patch 校验，引擎接缝与结构化错误分类由 `tests/seam.spec.ts` 钉住，结构化结果契约由 `tests/contract.spec.ts` 钉住，插件端到端启动由 `tests/keyless-smoke.e2e.ts` 验证。

```sh
# From the worktree, after pnpm install:
pnpm exec vitest run examples/dsh-pes/tests/loader.spec.ts examples/dsh-pes/tests/seam.spec.ts examples/dsh-pes/tests/contract.spec.ts
pnpm exec vitest run --config vitest.e2e.config.ts examples/dsh-pes/tests/keyless-smoke.e2e.ts
# The same suites against built lib/ (as CI runs them):
DSH_EXAMPLE_MODE=lib pnpm exec vitest run examples/dsh-pes/tests/loader.spec.ts examples/dsh-pes/tests/seam.spec.ts examples/dsh-pes/tests/contract.spec.ts
DSH_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.e2e.config.ts examples/dsh-pes/tests/keyless-smoke.e2e.ts
```

## 设计不变量（改动前请先读）

- 引擎只能通过配置的 command 接缝（`engine.js`）到达：运行时绝不导入 `event_index`、兄弟 checkout 或可变分支。
- 结果永远是有界的结构化信封——completed 调用仍可能是 `abstained`；每个引擎失败都变成结构化 `error` 结果，绝不抛错或返回"空但成功"的答案。
- 边界活在插件（`query.js`）里，而不只在 schema：支持的 schema 子集没有数值/字符串长度关键字，所以 `n`、状态数组大小、文本长度在任何 spawn 之前都会做语义校验。
- 误配置在加载时 fail loud（`config.command`、`timeout_ms`），或在调用时呈现为 `engine-unavailable`（缺事件索引）——绝不停默。
- 只注册已实现的工具：恰好上面四个名字；没有幻影表面。
