# Agent Note: aws-headless runtime semantic/trace E2E 驱动

Status: implemented

[English](2026-08-23-dsh-aws-headless-runtime-driver.md) | 中文

## Problem

[aws-runtime-on-S1 集成](2026-08-23-dsh-aws-runtime-on-s1-integration.md)组装了 aws-headless profile，但没有交付可运行的运行时任务：云 worker 缺少一个确定性的入口来启动真实组装后的 profile 并端到端证明语义面与 trace 面。另外，trace 发射器的签名头部（`x-dsh-signature`）与 CP webhook-verify 约定不一致，对真实路由的每次 trace POST 都会 401；dsh-segment 线上已评审的修复（`7ea1e817`，把头部对齐为 `x-webhook-signature`）尚未 merge-forward 进 aws-runtime 分支。

## Decision

- **Merge-forward 已评审的发射器修复。** `integration/aws-runtime-r1-double-prime`合并 `flinter/dsh-segment@7ea1e817d84a79444d1442883c94a38117c73aed`（`x-webhook-signature`头部对齐），同时保留 aws-runtime 额外内容；插件不重新实现、也不 cherry-pick。trace 发射器声明、测试、README 以及本说明的前身中陈旧的 `x-dsh-signature` 字面量在同一变更中跟进。
- **运行时驱动（`examples/aws-headless/runtime-driver.js`）。** 可复用驱动通过 Loader 启动**真实组装后的** aws-headless profile，把 `RUN_BASELINE_PHYSICS` 仅作为接口检查驱动（要求并如实报告 `prototype_stub` abstention，绝不作为科学成功），并以确定性查询针对运行时语料与引擎驱动`search_events`，要求 `status: completed`、`abstained: false`、有界结果、`provenance.engine_pin` 中固定的 producer 引擎 `c05c3fc747f0aa0fcb9d0603009add71c59e091b`，以及配置了 `$PES_TRACE_*` 时自动 trace 发射为 `accepted`。它恰好输出一行有界、机器可读的 JSON 摘要，并按失败类别以非零退出（语料缺失 2、引擎失败 3、abstention 4、provenance 畸形 5、 trace 传输 6、基线接口检查 7；启动 1）。全程不做任何 LLM/模型决策；摘要自我声明为 runtime semantic/trace E2E（`scientific_proof: false`），绝不是 TowerH 证明。
- **生产模式不回退 fixture。** 引擎接缝只解析 `$PES_QUERY_COMMAND` 或打包的`python3 -m event_index.query` 默认命令；测试 fixture 仅用于失败分类。
- **无密钥进程测试（`tests/runtime-driver.e2e.ts`）。** 驱动作为子进程运行在真实 aws-headless Loader 之上，配以 localhost 回调接收器与确定性引擎命令（协议兼容 stub）。断言覆盖单行摘要、自动发射端到端（精确规范字节、`x-webhook-signature` HMAC-SHA256 头部、固定 producer SHA、确定性记录 id），以及每个非零退出类别——配以专门 fixture（失败引擎、 abstain 引擎、通过 `materializeProfile(..., { enginePin: false })` 生成的未固定 pin profile、 500 接收器）。
- **文档。** aws-headless README 为 data-infra 运行时记录入口调用与退出码表；dsh-pes trace-emitter 说明中的头部事实更正为 `x-webhook-signature`。

## Alternatives considered

**生产环境针对 fixture 组合（例如 dsh-pes smoke 的 cordis.yml）运行驱动。**否决：运行时任务必须启动真实组装后的 profile，使组合回归——缺失 bundle 或未固定引擎——fail loud，而不是通过缩水配置；fixture 仅限测试。

**把 RUN_BASELINE_PHYSICS stub 当作科学成功。** 否决：诚实的 `prototype_stub` abstention 就是接口契约；驱动要求它、把它作为接口检查报告，并把摘要标记为 `scientific_proof: false`。

**把驱动做成 agent-loop 任务、让模型决定。** 否决：运行时 E2E 需要无需 LLM key 或模型调用的确定性；模型决策会使失败分类不确定。

**驱动内部读取接收器来验证 trace 发射。** 否决：传输归属意味着驱动绝不选择或观察自己的目的地；驱动要求发射器运行时报告的 `accepted` 结果，测试的接收器负责证明线上记录。

## Consequences

- double-prime 分支携带已评审的签名修复（头部现为 `x-webhook-signature`，与 CP webhook-verify 约定一致），aws-headless 线现在拥有确定性的 runtime semantic/trace E2E，并带文档化的入口（`node --import tsx/esm examples/aws-headless/runtime-driver.js`）从运行时所有的 `PES_TRACE_AWS_PROFILE` 与 `PES_TRACE_TASK_ARGS` 读取 profile 和确定性查询参数。与 data-infra G3/G4 运行时可以调用的退出码契约。
- 驱动不做任何 AWS/provider 调用，也不做任何 LLM 调用；`DSH_COMMIT`、控制平面代码、凭据以及 dsh-pes/dsh-segment 工具语义均不变。
- 仍然 NOT_RUN：真实 CP `/webhooks/dsh-worker/trace` 路由加 Postgres ancestry 校验、运行时引擎打包（部署时可导入的 `python3 -m event_index.query`）以及真实 TowerH 科学门禁——驱动只是 runtime semantic/trace E2E 证据。
