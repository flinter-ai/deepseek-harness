# @flinter/dsh-segment

[English](README.md) | 中文

**S1 语义能力层** —— 仍是原型/参考实现，不是生产科学能力。S1 用 ONE 个已注册的语义能力 `RUN_BASELINE_PHYSICS` 取代 S0 原型工具表面；五个 S0 原型原语（`frames.sample`、`track.cotracker`、`boundary.detect`、`vlm.ask`、`artifact.write`）现在是能力适配器驱动的内部函数，不再注册为任何外部工具。每个结果都显式弃权（`abstention: 'prototype_stub'`）并携带 provenance，因此永远不会被误当作真实的 TowerH 物理输出。

该插件是一个 bundle（`dsh.bundle.patch` → `cordis.patch.yml`），headless profile 会把它发现并作为一行挂载在其它 bundle 之旁。本里程碑不含 TowerH/TowerT、VLM、DINOv2、Foote、CoTracker、B2、会话持久化、重试或控制面接线。

## Scope: S1 (what this layer proves)

- 类型化的语义请求/结果信封：输入 schema（`window`，以及可选的 `budget`）与输出 schema（provenance + abstention + `content_hash`）由 tools registry 强制校验并由测试钉住。
- 最小能力注册表（id → adapter），只注册一个能力；未知 id 立即失败，不宣传任何幻影能力名。
- 弃权语义：每个结果都携带 `abstention: 'prototype_stub'` 以及列出每个内部阶段内容哈希的 provenance，stub 永远不能当作真实物理输出来消费。
- 输入校验、fail-closed：请求契约恰好是 `{ window, budget }`；`budget` 必须是正整数（schema 拒绝非整数，adapter 在任何阶段运行前拒绝非正值），任何未知请求键——例如模型自带的 `out_dir`——都会被拒绝而不是静默忽略，因此运行时所有的产物路径永远无法从模型侧被改写。
- Loader 表面上的真实成功/失败终态行为：合法调用返回结构化信封；畸形调用、非法 budget、未知请求键、未知能力名都以真实注册工具产生的真实 `isError` 工具结果终止——全程没有手搓的回调。
- 无凭据的 worker 启动 → 语义能力 → 产物写入路径：测试不接触 TowerH、TowerT、VLM、B2 或任何真实 provider。
- 装配式 Loader 证明：`tests/assembled-smoke.e2e.ts` 按 dsh profile launcher 为 worker 镜像里 headless profile 叠加的方式，组合真实 bundle patch 层（`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless` + 本 bundle），通过真实 Loader 启动装配后的树，并端到端驱动语义表面。

适配器串联冻结的 S0 原语 `sampleFrames` → `trackWindow` → `detectBoundaries` → `writeArtifact`，并把确定性 stub 产物包装成类型化信封：

| Surface | Role | Result |
|---|---|---|
| `RUN_BASELINE_PHYSICS` | 唯一注册的语义能力 | 带 provenance + `abstention` + `content_hash` 的类型化信封；格式无效/budget 非法/未知请求返回 fail-closed 的 `isError` |
| frames.sample, track.cotracker, boundary.detect, vlm.ask, artifact.write | 内部函数，不注册为工具 | 带 sha256 哈希的分阶段 stub 产物 |

## Not in S1 (later milestone / CP tracks)

- 真实的 CoTracker / VLM / DINOv2 / Foote / TowerH 集成。
- `InvestigationRun` / `dshSessionId` 持久化、Postgres、lease/fencing、重试、Fargate 启动或回调、共享会话根 / 检查点、跨 Fargate 恢复、B2 写入、会话日志上送。
- 更多语义能力（`INSPECT_TRACE_GAP` 及其余未来列表）——不注册；注册表只注册已实现的能力。
- 把本分支直接合并进 `flinter/aws-runtime`，或在本分支上更新 `DSH_COMMIT`。（S1 这条线本身通过普通 PR 合入 `flinter/dsh-segment` —— 那是预期目标，不是被禁止的合并。）

## Loading and tests

headless profile 按 `dsh.profile.bundles` 顺序叠加 bundle；把 `@flinter/dsh-segment` 加入该列表（worker 镜像正是如此）即可通过 `cordis.patch.yml` 挂载插件。在本仓库中，该组合由 `tests/loader.spec.ts` 对着真实 bundle patch 校验，语义契约由 `tests/contract.spec.ts` 钉住，插件端到端启动由 `tests/keyless-smoke.e2e.ts` 验证，装配后的 headless 组合（base + headless + 本 bundle，即 worker 镜像挂载的精确层次）由 `tests/assembled-smoke.e2e.ts` 通过真实 Loader 启动并驱动。

```sh
# From the worktree, after pnpm install:
pnpm exec vitest run examples/dsh-segment/tests/loader.spec.ts examples/dsh-segment/tests/contract.spec.ts
pnpm exec vitest run --config vitest.e2e.config.ts examples/dsh-segment/tests/keyless-smoke.e2e.ts examples/dsh-segment/tests/assembled-smoke.e2e.ts
# The same suites against built lib/ (as CI runs them):
DSH_EXAMPLE_MODE=lib pnpm exec vitest run examples/dsh-segment/tests/loader.spec.ts examples/dsh-segment/tests/contract.spec.ts
DSH_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.e2e.config.ts examples/dsh-segment/tests/keyless-smoke.e2e.ts examples/dsh-segment/tests/assembled-smoke.e2e.ts
```

## Next steps (not S1)

- 在能力适配器背后接入真实的 sampler/tracker/detector，用真实输出信封取代弃权 stub。
- 当 window 时长和真实采样语义确定后，定义由运行时所有的采样/资源策略；在分配帧之前由该策略推导并校验任何上限，而不是恢复模型可见的固定 budget 上限。
- 随着适配器落地再注册更多语义能力。
- 用 B2 capability-URL 写入替换 `writeArtifact` stub。
- 在 teardown 时将会话日志上送 B2。

## Design invariants (read before changing)

- 只注册已实现的能力：工具名单恰为 `[RUN_BASELINE_PHYSICS]`；绝不宣传尚未实现的名字。
- 原型原语是内部实现：S0 的五个工具（`frames.sample`、`track.cotracker`、`boundary.detect`、`vlm.ask`、`artifact.write`）是适配器驱动的普通函数，不是公开表面。
- stub 结果永远显式 abstained：`abstention: 'prototype_stub'` + provenance + `content_hash` —— stub 绝不能被当作实测物理输出消费。
- 请求在语义边界 fail-closed：适配器在任何阶段运行前强制 `{ window, budget }` 契约、非空字符串 window、以及正整数 budget——失败的调用不写产物、不伪造 provenance。未知请求键（包括任何模型自带的 `out_dir`）被拒绝而不是静默忽略，因此产物路径始终是 plugin config → 运行环境 → 模块默认。在真实采样器和运行时所有的资源策略确定上限之前，不声明固定最大值。
- 能力今天以**模型可见的 TOOL** 暴露：DSH 拥有调查权，控制面不选择科学能力。只有当运行时必须在模型启动前强制执行 baseline 时才切换到内部 service 接缝 —— 那是 S2/runtime-contract 轨道，不是本插件的 S1。
- 合并门槛：只有语义契约检查点通过后，才允许建立把本线与 `flinter/aws-runtime` 结合的 integration 分支（届时才更新 `DSH_COMMIT`）。
