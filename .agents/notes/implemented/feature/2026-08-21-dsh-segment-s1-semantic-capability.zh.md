# Agent Note: dsh-segment S1 语义能力

Status: implemented

[English](2026-08-21-dsh-segment-s1-semantic-capability.md) | 中文

## Problem

S0 原型（[2026-08-21-dsh-segment-s0-prototype-skeleton](2026-08-21-dsh-segment-s0-prototype-skeleton.md)）以五个已注册原型工具（`frames.sample`、`track.cotracker`、`boundary.detect`、`vlm.ask`、`artifact.write`）作为公开表面冻结。这个表面正是控制面 lane 必须避免的陷阱：编排方（aws-runtime）可能直接调用原型原语、把确定性 stub 误当成生产物理输出，或依赖后续里程碑将改名的工具。生产方向把语义能力（`RUN_BASELINE_PHYSICS`、`INSPECT_TRACE_GAP`、…）作为公开接口，原型原语则是能力注册表背后的实现细节。

## Decision

在分支 `feat/dsh-segment-s1`（base `bca4a955`，冻结的 S0 HEAD）上发布 S1 语义能力层：

- `examples/dsh-segment/index.js` 只注册 ONE 个工具 `RUN_BASELINE_PHYSICS`——唯一注册的语义能力。五个 S0 原语变成 `tools/` 下的普通内部函数（`sampleFrames`、`trackWindow`、`detectBoundaries`、`askVlm`、`writeArtifact`）；没有一个被注册，因此任何原语都不可被外部调用，也不宣传任何幻影能力名。
- 最小能力注册表（`capabilities/registry.js`）把 id 映射到 adapter，只列出已注册 id，未知 id 立即失败，`register()` 返回 disposer。工具的 `execute` 经由它分发。
- `capabilities/run-baseline-physics.js` 拥有类型化请求/结果 schema 与适配器。适配器按运行时/配置所有权解析产物路径（`config.out_dir ?? SEGMENT_OUT_DIR 环境变量 ?? 默认`）——绝不取自模型请求——并串联 `sampleFrames → trackWindow → detectBoundaries → writeArtifact`，并把确定性 stub 产物包装成携带 `capability_id`、`schema_version`、`status`、`abstention: 'prototype_stub'`、provenance（每个内部阶段的内容哈希）、产物引用与信封 `content_hash`（对其它所有字段的规范化 JSON 求 sha256）的类型化信封。写入磁盘的产物字节哈希等于产物引用的 `content_hash`。
- 真实的 S1 执行路径校验输入并 fail-closed：请求契约恰好是 `{ window, budget }`；`budget` 必须是正整数。适配器在任何阶段运行前于语义边界校验，对未知请求键（模型自带的 `out_dir` 被拒绝而不是静默忽略）、缺失/空 `window`、非正/非整数 `budget` 抛出确定性的 `CapabilityRequestError`——失败的调用不写产物、不伪造 provenance，tools registry 把每次违规归一化为 DSH 的 `isError` 终态结果。请求 schema 把 `budget` 声明为 `type: 'integer'`，因此非整数在 schema 层以 `INVALID_ARGS` fail-closed；正值要求由适配器强制，直接调用 registry 的调用方无法绕过。在真实采样器和运行时所有的资源策略确定上限之前，不声明固定最大值。
- 弃权是硬性标记而不是偶然：stub 结果永远不会被当作实测物理输出来消费（MISS 保持 MISS）。`askVlm` 仍是 S1 尚无能力触达的内部原语。
- 测试：新增 `tests/contract.spec.ts`——模拟只使用语义表面的 aws-runtime 风格调用方：启动真实 Loader 组合，断言类型化结果、provenance、弃权标记、内容哈希一致性（信封哈希、阶段哈希、磁盘字节）以及适配器的 fail-closed 请求校验。该测试还证明高于已废弃原型上限的合法正整数 budget 可成功。`tests/keyless-smoke.e2e.ts` 及其 driver 在 src 与构建后的 `lib/` 两种模式下断言注册形态（恰好 `[RUN_BASELINE_PHYSICS]`）、确定性、产物写入路径以及真实表面上的 fail-closed 终态路径（schema 无效、schema 非整数、适配器非正 budget 失败、未知请求键、未知能力）。`tests/assembled-smoke.e2e.ts` 组合 worker 镜像实际挂载的 bundle patch 层（`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless` + 本 bundle），按 dsh profile launcher 应用相同分层 patch 的方式通过真实 Loader 启动装配后的树，证明真实 DSH loader 注册 `RUN_BASELINE_PHYSICS` 且每条终态路径成立。`tests/loader.spec.ts` 继续证明 bundle 发现。
- `README.md` / `README.zh.md` 描述 S1：一个语义能力、内部原型原语、弃权语义、正整数 budget 校验与 fail-closed 请求校验。`package.json` 的 `files` 增加 `capabilities/`，使打包后的消费者能解析入口 import。

S1 不增加 `InvestigationRun`/`dshSessionId` 持久化、Postgres 存储、lease/fencing/重试、Fargate 启动或回调、共享会话根/检查点/恢复、B2 写入、真实 CoTracker/VLM/DINOv2/Foote/TowerH/TowerT 集成、更多语义能力，也不包含需要真实模型的 headless 一次性任务运行（装配式 smoke 禁用了 `headless-runner` 行——一次性任务轨道需要真实 provider，不属于 S1 工具表面）。不修改 `flinter/aws-runtime`、`flinter/dsh-segment`、`deploy/dsh-worker/DSH_COMMIT` 或 `~/.dsh` 凭据/配置。

## Alternatives considered

**在 tools 表面之外把语义能力暴露为 Cordis service。** 已否决（S1 阶段）：DSH 拥有调查权（控制面不选择科学能力），因此能力刻意保持模型可见；CP2–CP10 轨道落地前不存在运行时派发/service 契约，平行 service 会引入第二条调用路径并为单一调用方重复 schema 校验与执行机制。这是一个有意识的选择，不是偶然——见 `## Deferred`。

## Deferred

供运行时强制调用能力的 service 接缝推迟到 S2/runtime-contract 轨道（CP lane）。在该轨道落地前，本插件的语义能力按上述决定保持为模型可见的工具；只有当下一个运行时必须在模型启动前强制执行 baseline 时才切换到 service 接缝，而不是单纯为了把它从工具名单里藏起来。

**把五个原型工具与语义能力一起继续注册。** 已否决：它们仍然看起来可调用，无论能力宣传得多么显眼，stub 原语都依然是原型陷阱。

**注册包含未来 id（`INSPECT_TRACE_GAP`、…）的能力总表。** 已否决（no-phantom-list 规则）：注册表只注册已实现的能力，`list()` 只回答已注册 id。

**内部串联改用 `defineTool` 包装的工厂而非普通函数。** 已否决：原语不再需要工具注册表校验或呈现，适配器的直接调用是参数的确定性纯函数。

## Consequences

公开表面现在是一个语义能力，因此 S0 的 loader/keyless smoke 形态改变（调整而非删除），五个原语名不再可被外部调用。信封 `content_hash` 跨运行保持确定性，因为机器相关状态（产物路径）被排除在哈希之外；产物引用记录 name + hash，产物路径由运行时/配置所有（plugin config → 运行环境 → 默认），绝不是模型可见的请求旋钮——任何改写它的尝试（模型自带的 `out_dir`）都以未知请求键 fail-closed。成功与失败都是 Loader 表面上的真实终态结果：合法调用返回类型化信封，畸形/非法 budget/未知请求以实际注册工具产生的 `isError` 结果终止，全程没有手搓的回调。`askVlm` 作为冻结的内部原语留给后续状态核验能力。S0 笔记中"下一项任务"的句子被本笔记取代，S0 笔记现已交叉链接到本笔记。集成合并门槛仍然成立：只有在该语义检查点之后，才允许建立 integration 分支把 DSH 线与 `aws-runtime` 结合，届时才可更新 `DSH_COMMIT`——该集成仍是未来工作。
