# @flinter/dsh-segment

[English](README.md) | 中文

**S1 语义能力层** —— 仍是原型/参考实现，不是生产科学能力。S1 用 ONE 个已注册的语义能力 `RUN_BASELINE_PHYSICS` 取代 S0 原型工具表面；五个 S0 原型原语（`frames.sample`、`track.cotracker`、`boundary.detect`、`vlm.ask`、`artifact.write`）现在是能力适配器驱动的内部函数，不再注册为任何外部工具。每个结果都显式弃权（`abstention: 'prototype_stub'`）并携带 provenance，因此永远不会被误当作真实的 TowerH 物理输出。

该插件是一个 bundle（`dsh.bundle.patch` → `cordis.patch.yml`），headless profile 会把它发现并作为一行挂载在其它 bundle 之旁。本里程碑不含 TowerH/TowerT、VLM、DINOv2、Foote、CoTracker、B2、会话持久化、重试或控制面接线。

## Scope: S1 (what this layer proves)

- 类型化的语义请求/结果信封：输入 schema（`window`，以及可选的 `budget` / `out_dir`）与输出 schema（provenance + abstention + `content_hash`）由 tools registry 强制校验并由测试钉住。
- 最小能力注册表（id → adapter），只注册一个能力；未知 id 立即失败，不宣传任何幻影能力名。
- 弃权语义：每个结果都携带 `abstention: 'prototype_stub'` 以及列出每个内部阶段内容哈希的 provenance，stub 永远不能当作真实物理输出来消费。
- 无凭据的 worker 启动 → 语义能力 → 产物写入路径：测试不接触 TowerH、TowerT、VLM、B2 或任何真实 provider。

适配器串联冻结的 S0 原语 `sampleFrames` → `trackWindow` → `detectBoundaries` → `writeArtifact`，并把确定性 stub 产物包装成类型化信封：

| Surface | Role | Result |
|---|---|---|
| `RUN_BASELINE_PHYSICS` | 唯一注册的语义能力 | 带 provenance + `abstention` + `content_hash` 的类型化信封 |
| frames.sample, track.cotracker, boundary.detect, vlm.ask, artifact.write | 内部函数，不注册为工具 | 带 sha256 哈希的分阶段 stub 产物 |

## Not in S1 (later milestone / CP tracks)

- 真实的 CoTracker / VLM / DINOv2 / Foote / TowerH 集成。
- `InvestigationRun` / `dshSessionId` 持久化、Postgres、lease/fencing、重试、Fargate 启动或回调、共享会话根 / 检查点、跨 Fargate 恢复、B2 写入、会话日志上送。
- 更多语义能力（`INSPECT_TRACE_GAP` 及其余未来列表）——不注册；注册表只注册已实现的能力。
- 把本分支合并进 `flinter/aws-runtime` 或 `flinter/dsh-segment`。

## Loading and tests

headless profile 按 `dsh.profile.bundles` 顺序叠加 bundle；把 `@flinter/dsh-segment` 加入该列表（worker 镜像正是如此）即可通过 `cordis.patch.yml` 挂载插件。在本仓库中，该组合由 `tests/loader.spec.ts` 对着真实 bundle patch 校验，语义契约由 `tests/contract.spec.ts` 钉住，插件端到端启动由 `tests/keyless-smoke.e2e.ts` 验证。

```sh
# From the worktree, after pnpm install:
pnpm exec vitest run examples/dsh-segment/tests/loader.spec.ts examples/dsh-segment/tests/contract.spec.ts
pnpm exec vitest run --config vitest.e2e.config.ts examples/dsh-segment/tests/keyless-smoke.e2e.ts
# The same suites against built lib/ (as CI runs them):
DSH_EXAMPLE_MODE=lib pnpm exec vitest run examples/dsh-segment/tests/loader.spec.ts examples/dsh-segment/tests/contract.spec.ts
DSH_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.e2e.config.ts examples/dsh-segment/tests/keyless-smoke.e2e.ts
```

## Next steps (not S1)

- 在能力适配器背后接入真实的 sampler/tracker/detector，用真实输出信封取代弃权 stub。
- 随着适配器落地再注册更多语义能力。
- 用 B2 capability-URL 写入替换 `writeArtifact` stub。
- 在 teardown 时将会话日志上送 B2。