# @flinter/dsh-segment

[English](README.md) | 中文

**S0 原型 / 参考骨架** —— 不是生产科学实现。这是 DeepSeek Harness 的 FLINTER 段插件的第一个里程碑：用于以确定性 stub 证明“容器启动 → 工具调用 → 产物写入”路径，并冻结后续里程碑将要实现的工具名/schema 契约。

该插件是一个 bundle（`dsh.bundle.patch` → `cordis.patch.yml`），headless profile 会把它发现并作为一行挂载在其它 bundle 之旁。本里程碑不含 TowerH/TowerT、VLM、DINOv2、Foote、CoTracker、B2、会话持久化、重试或控制面接线——这些是后续轨道，不属于 S0。

## Scope: S0 (what this skeleton proves)

- 包能从干净 checkout（独立 worktree）加载。
- headless profile 通过 `cordis.patch.yml` 发现插件。
- 五个原型工具都能注册并接受合法输入：
  | Tool | Input | Deterministic stub output |
  |---|---|---|
  | `frames.sample` | `window`, optional `budget` | fixed frame list + artifact descriptor |
  | `track.cotracker` | `window`, `seeds[]` | fixed track descriptor |
  | `boundary.detect` | `track_ref` | fixed candidate list |
  | `vlm.ask` | `frames_ref`, `question` | fixed canned answer |
  | `artifact.write` | `name`, `data`, optional `out_dir` | writes the payload to disk |
- 每个工具都返回 schema 合法的确定性 stub 结果，并带自身产物载荷的 SHA-256 内容哈希（`artifact` + `content_hash`）。
- worker 启动 / 工具调用路径以 **无凭据（keyless）** 方式 smoke 测试——测试不接触 TowerH、TowerT、VLM、B2 或任何真实 provider。

## Not in S0 (later milestone / CP tracks)

- 真实的 CoTracker / VLM / DINOv2 / Foote / TowerH 集成。
- `InvestigationRun` / `dshSessionId` 持久化、Postgres、lease/fencing、重试、Fargate 启动或回调、共享会话根 / 检查点、跨 Fargate 恢复、B2 写入、会话日志上送。
- 语义能力注册表或重命名原型工具（独立任务）。
- 把本分支合并进 `flinter/aws-runtime` 或 `flinter/dsh-segment`。

## Loading and tests

headless profile 按 `dsh.profile.bundles` 顺序叠加 bundle；把 `@flinter/dsh-segment` 加入该列表（worker 镜像正是如此）即可通过 `cordis.patch.yml` 挂载插件。在本仓库中，该组合由 `tests/loader.spec.ts` 对着真实 bundle patch 校验，插件端到端启动由 `tests/keyless-smoke.e2e.ts` 验证。

```sh
# From the worktree, after pnpm install:
pnpm exec vitest run examples/dsh-segment/tests/loader.spec.ts
pnpm exec vitest run --config vitest.e2e.config.ts examples/dsh-segment/tests/keyless-smoke.e2e.ts
```

## Next steps (not S0)

- 在冻结的 schema 背后接入真实的 sampler/tracker/detector。
- 用 B2 capability-URL 写入替换 `artifact.write` stub。
- 为 Trigger.dev waitpoints 增加 `ctx.userQuestions` 适配器。
- 在 teardown 时将会话日志上送 B2。