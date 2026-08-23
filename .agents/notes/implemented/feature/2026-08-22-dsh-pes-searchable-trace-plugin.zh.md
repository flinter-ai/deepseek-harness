# Agent Note: dsh-pes 可搜索轨迹插件

Status: implemented

[English](2026-08-22-dsh-pes-searchable-trace-plugin.md) | 中文

## 问题

可搜索轨迹 producer 切片（[flinter-ai/flinter-common `feat/searchable-trace-engine`](https://github.com/flinter-ai/flinter-common)，不可变 SHA `c05c3fc747f0aa0fcb9d0603009add71c59e091b`）交付了引擎——`event_index` 及带四个有界模式（search / similar / counterfactual / zoom）的 `event_index.query` JSON-lines CLI——但没有 Agent 面。DSH 侧需要一个兄弟插件，把这四个模式暴露为原生工具，同时遵守 producer 的边界规则：引擎必须通过显式配置的 command 接缝到达（运行时绝不从兄弟 checkout 或可变分支导入），并且本地引擎的诚实语义（provenance、abstention、有界输出）及其失败面（malformed input、timeout、nonzero exit、artifact references）必须以结构化工具结果存活，而不是被吞掉。

## 决策

在分支 `feat/dsh-pes-plugin`（基线 `5c679222`，已合并的 dsh-segment S1 checkpoint `flinter/dsh-segment`）上交付 `examples/dsh-pes`（`@flinter/dsh-pes`），沿用 dsh-orca 插件的结构约定（bundle patch + profile 发现 loader spec + 基于 fixture stub 的 keyless Loader smoke）：

- **四个已注册工具，一个共享的有界信封。** `search_events`、`find_similar_states`、`find_counterfactuals`、`zoom` 与引擎模式一一对应。结果数 `n` 有上限（`MAX_RESULT_N` = 50）并钳制到语料大小；状态数组（≤ 32 项）、文本字段（≤ 1024 字符）、引擎 stdout/stderr 字节上限（8 MiB / 256 KiB）约束每个请求与响应。数值/长度边界放在 `query.js` 的语义校验里，而不是 schema 里，因为 tools JSON-schema 子集没有这类关键字（已对照 `packages/core/tools/src/json-schema.ts` 核实）。
- **显式引擎接缝（`engine.js`）。** CLI 作为子进程 spawn，stdin 写入一行 JSON 请求；插件绝不导入 `event_index`、兄弟 checkout 或可变分支。命令解析：`config.command` → `$PES_QUERY_COMMAND`（JSON 数组）→ 打包默认值 `['python3', '-m', 'event_index.query']`；事件索引：`config.events` → `$PES_EVENTS_ENRICHED_JSONL`，总是显式以 `--events PATH` 传入。`timeoutMs` 在加载时校验（1..120000）；超时杀子进程并结算为 `engine-timeout`。
- **结构化结果保留引擎的诚实与失败面。** 每个结果都是带 `provenance`（插件 + 引擎协议 + 可选 `engine_pin`）的信封；逐事件 provenance 原样透传；引擎诚实弃权映射为 `status: 'abstained'`（绝不当作错误）；稳定的 `error.kind` 覆盖 `malformed-input`、`engine-timeout`、`engine-nonzero-exit`、`engine-malformed-response`、`engine-unavailable`、`artifact-reference-missing`。引擎逐请求 `{"error": ...}` 响应变成 `malformed-input` 结果；无可解析响应时的非零退出保留 `exit_code` + 有界 `stderr`；返回事件的 `source_path` 在 `config.artifactsRoot` 下无法解析时整次调用 fail loud（fail-closed）。
- **按既有约定做 bundle/patch/config 接线。** `cordis.patch.yml` 插入 `dsh-pes` 行；`examples/package.json` 链接 `@flinter/dsh-pes: link:./dsh-pes`（pnpm-lock.yaml 更新 3 行）；`tests/loader.spec.ts` 用真实 `composeEntries`/`loadOverlayPatches` 驱动已检入的 base + headless + pes patch 文件并断言该行；`tests/contract.spec.ts` + `tests/keyless-smoke.e2e.ts` 通过 `@deepseek-ai/dsh-loader-smoke` 从 `tests/fixtures/pes.cordis.yml` 启动真实 Loader，接缝由协议兼容的 fixture stub（`stub-engine.mjs`，自包含——按文档契约针对 fixture 语料重新实现，绝不导入引擎）填充；`tests/seam.spec.ts` 在进程内钉住接缝与整个分类体系（timeout、nonzero exit、ENOENT、三种协议违规、插件侧与引擎侧 malformed input、两条弃权路径、缺失工件 fail-closed、边界、config/env 优先级）。
- **集成 gate 仅文档化，未完成。** 运行时引擎打包与不可变 producer 钉扎属于集成 gate：README 把 producer SHA 记录为 provenance 文档，并文档化 `config.engine_pin`（流入每个结果的 `provenance.engine_pin`）；在打包落地前，无法导入的引擎呈现为结构化 `engine-nonzero-exit`/`engine-unavailable` 结果，绝不是静默空答案。

本 PR 不改动 `flinter/aws-runtime`、`DSH_COMMIT`、控制平面代码、`~/.dsh` 凭据/设置，也不触碰任何 AWS/云资源。它不把 dsh-segment（或 dsh-pes）并入 aws-runtime。

## 备选方案

**直接从兄弟 worktree 导入引擎包。** 否决：任务边界禁止在运行时导入兄弟 checkout 或可变分支；硬导入会把本仓库插件耦合到一个未钉扎的路径上，而该路径对其它消费者（CI、worker）不存在。子进程接缝把边界保持在显式配置的命令上。

**用 JSON-schema 关键字（`minimum`、`minLength`、`maxItems`）校验边界。** 对照 `packages/core/tools/src/json-schema.ts` 核实后否决：强制子集只支持 type/oneOf/properties/required/additionalProperties/items/enum/const + 注解，数值/长度约束会在 Loader 启动时就失败。语义校验放在 `query.js` 任何 spawn 之前（fail-loud 结构化 `malformed-input`，而不是静默钳制）。

**把引擎失败返回为抛错 / `isError` 结果。** 否决：任务要求失败必须作为*结构化工具结果*保留；设计把每个引擎失败映射进信封的 `error` 块并带稳定 `kind`（tools registry 仍为 schema 违规与未知工具名拥有 `isError`）。

## 后果

插件恰好注册四个工具；`tests/loader.spec.ts`、`tests/seam.spec.ts`、`tests/contract.spec.ts`、`tests/keyless-smoke.e2e.ts` 在 src（tsx）与构建后的 `lib/` 两种模式都通过。在部署钉扎引擎之前，`engine_pin` 以缺失（而非 `null`）表达——显式的"未钉扎" provenance，与集成 gate 的范围一致。fixture 事件语料（schema 精确的 PhysicalEvent JSONL，作者阶段用 producer loader 推导，带 `source_path` 工件引用）与 `tests/fixtures/artifacts/` 下的两个扫描 artifact 只是检入的测试数据。下一步是集成 gate：打包引擎让 `config.command` 的默认值可用、钉扎 producer SHA、并对照真实索引/标签验证——这些在本 PR 中全部显式 NOT_RUN。dsh-segment S1 note 未改动；本 note 记录兄弟的可搜索轨迹表面。
