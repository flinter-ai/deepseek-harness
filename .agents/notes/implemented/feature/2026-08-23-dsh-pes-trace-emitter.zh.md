# Agent Note: dsh-pes 运行时自有可搜索轨迹发射器

Status: implemented

[English](2026-08-23-dsh-pes-trace-emitter.md) | 中文

## 问题

可搜索轨迹 producer 接缝的 CP 侧（T1）在 `flinter-data-infra` 里提交了 `validateSearchableTraceRecord` 线上契约和 `POST /webhooks/dsh-worker/trace` 路由，并把一个缺失的 **worker 侧发射钩子**列为未解决依赖：DSH 侧目前还没有在任何搜索结果之后发布有界可搜索投影。dsh-pes 插件（[2026-08-22 可搜索轨迹插件 note](2026-08-22-dsh-pes-searchable-trace-plugin.md)）交付了四个可搜索轨迹工具，但没有 producer 副作用。本切片在现有 `examples/dsh-pes` 结果/完成路径上新增最小的运行时自有自动发射器——明确**不是**模型可见的 trace 工具，**不是**第二套记录 schema，也**不是** H1/O1/O2 观察流实现（CP 记录仍然只是有界可搜索投影；后续 H1 桥可以用共享 provenance id 把同一科学结果追加到权威 DSH 观察流）。

## 决策

在分支 `feat/dsh-trace-emitter`（基线 `c799c35a7a`，已合并的可搜索轨迹插件 checkpoint）上交付 `examples/dsh-pes/trace-record.js`（纯线上契约接缝）+ `examples/dsh-pes/trace.js`（运行时发射器），把发射以副作用形式接进 `runQuery` 的 completed 结果路径——该副作用绝不改变或失败科学结果：

- **纯 T1/T2 字节等价接缝（`trace-record.js`）。** 在本仓库中重新声明已提交的 CP 记录，包含其规范键序（`organizationId, projectId, episodeId, jobId, irId, jobOutputId, artifactId, runOrdinal, traceKind, summaryText, producerSha, schemaVersion, id`）、紧凑 JSON 序列化（`serializeTraceRecord`）、确定性 id `tr_<sha256(organizationId:irId:runOrdinal)>` 前 24 个十六进制字符（`searchableTraceIdFor`，与已提交 CP 推导逐字节一致）以及 HMAC-SHA256 小写十六进制签名器（`signTraceBody`）。不导入任何控制平面包、兄弟仓库或可变分支——接缝是纯的、自包含的，因此 T1/T2 fixture 可以断言相同输入产生相同字节。
- **运行时自有的传输与 ancestry（`trace.js`）。** 回调 URL、HMAC 密钥以及七个 ancestry id（organization/project/episode/job/ir/jobOutput/artifact）外加 `runOrdinalBase` 与 `postTimeoutMs` 只从经过校验的插件配置或 `PES_TRACE_*` 环境解析——绝不来自工具/模型请求字段。URL/密钥只配其一、或开启传输却缺少 ancestry，都会在加载时 fail loud；两者都缺则发射器保持禁用。头部为 `x-webhook-signature`（T1 producer 接缝读取的 CP webhook-verify 约定）。
- **确定性映射。** `traceKind` = 被调用的工具名；`summaryText` = 返回事件 id 与工具 echo 的有界（≤ 2000 字符）确定性投影；`producerSha` = `config.engine_pin`，否则是已提交的引擎 commit `c05c3fc…`（引擎 commit，绝不是 AWS 运行时修订）；`schemaVersion` = 已提交的数字字符串 `"1"`；`id` = 上述推导 id。`runOrdinal` 由发射器拥有：一个从 `runOrdinalBase` 开始的进程内计数器，每个不同的结果一个值，因此相同的结果序列总是得到相同的 ordinal 与 id。
- **至多一次 + 诚实分类。** POST 之前先用结果内容指纹在进程内去重：相同重复报告 `duplicate` 且绝不重复 POST（对每次成功结果尝试至多一次），而来自其它进程的 CP 重放通过确定性 id 保持幂等。传输结果被分类——accepted（2xx）、validation-rejected（400）、unauthorized（401）、conflict（409）、rejected（其它 4xx）、unavailable（5xx/503）、unreachable（网络）、unexpected——并且绝不改变科学结果。abstained/error 结果绝不发射（已提交的 trace 契约没有为它们定义 traceKind）。密钥与签名永不打印或持久化。
- **测试。** `tests/trace.spec.ts` 用固定 fixture 钉住确定性字节/签名、传输归属（config/env 优先级、部分接线 fail loud、无模型选择的目标）、成功自动发射、重复/重试行为、400/401/409/503 表，以及 abstained/error/disabled 不发射。共享的 `pes-driver.ts` 现在启动 localhost receiver，把 `PES_TRACE_*` 指向它，并在 contract 套件与 keyless smoke 中都断言：每个不同的 completed 结果恰好一条规范签名记录（run ordinal 0..3），相同重复调用被去重，结构化错误/注册表拒绝的调用零发射。

本 PR 不改动 `flinter/aws-runtime`、`DSH_COMMIT`、控制平面代码、`~/.dsh` 凭据/设置，也不触碰任何 AWS/云资源；不把本线并入 aws-runtime。dsh-pes 工具面（四个工具、有界信封）不变。

## 备选方案

**注册模型可见的 `EMIT_TRACE` 工具。** 否决：任务边界禁止 trace 工具；自动结果后发射才是 producer 副作用，而模型可调用的发射器会让模型选择目标与时机，违反运行时对传输的归属。

**从 `flinter-data-infra` 或兄弟 checkout 导入已提交的 CP 记录校验器。** 否决：任务禁止这类导入，接缝必须在本仓库内可测；已提交契约被逐字节重新声明在一个纯模块里，因此 T1/T2 字节等价性可以不需要 CP 包即可证明。

**为 abstained/error 结果用专门的 traceKind 发射。** 否决：已提交的 trace 契约没有定义这类 kind，任务也要求只在契约明确允许时发射；发射器跳过非 completed 结果，测试证明之。

**发射不等待（fire-and-forget，工具路径不 await）。** 定为在 `runQuery` 内 await 有界的 POST：发射在工具路径上变得确定、可观察，同时绝不失败结果；payload 很小且有经过校验的 1..60000 ms 截止。

## 后果

部署配置运行时传输后（否则保持禁用、行为不变，现有 S1 测试原样通过），插件现在对每个不同的 completed 可搜索结果发射一条 CP 可搜索轨迹记录。进程内至多一次意味着同一进程内相同重复搜索不会重复发射——跨进程幂等重放仍由 CP 通过确定性 id 负责。真实 `POST /webhooks/dsh-worker/trace` 路由、真实 Postgres FK ancestry 校验以及任何云资源仍为 NOT_RUN（本地 receiver + 分类状态是本地证据）。dsh-segment S1 note 与 2026-08-22 dsh-pes 插件 note 保持现状；本 note 记录接缝的运行时自有发射半边。
