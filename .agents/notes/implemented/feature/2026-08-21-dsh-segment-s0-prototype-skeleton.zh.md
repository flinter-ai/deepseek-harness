# Agent Note: dsh-segment S0 原型骨架

Status: implemented

[English](2026-08-21-dsh-segment-s0-prototype-skeleton.md) | 中文

## Problem

`examples/dsh-segment` 插件此前只是一个半成品骨架：其 `cordis.patch.yml` 仅含注释，任何 headless profile 都无法加载该插件；入口与五个原型工具没有注册、没有钉住性测试，也没有带内容哈希的确定性 stub 产物。缺少一个可证明、可冻结的检查点，原型原语就可能被误当作生产接口——正是控制面 lane 必须避免的陷阱（charter §3A）：S0 原型上的 loader/镜像 smoke 通过，不得授权合并进 `aws-runtime`，也不得当作生产完成。

## Decision

将 `dsh-segment` 插件的 S0 原型/参考骨架发布在分支 `feat/dsh-segment-s0`（base `flinter/dsh-segment` @ `20ec9d16`，最终 SHA `287548eb`）：

- `cordis.patch.yml` 现在插入真实的 bundle patch，注册 `id: dsh-segment, name: '@flinter/dsh-segment'`，使 headless profile 能发现并加载该插件。
- `index.js` 入口只注入 `['tools']`——插件从不使用 `jobs`，无用的注入会让激活受制于无关服务。
- `examples/package.json` 声明 `@flinter/dsh-segment` 的 link 依赖，运行时解析与 `verify-cordis-config` 的引用检查都需要它。
- 五个原型工具（`frames.sample`、`track.cotracker`、`boundary.detect`、`vlm.ask`、`artifact.write`）以稳定 schema 作为外部工具注册发布，并由新测试钉住；确定性 stub 产物的 sha256 `content_hash` 与实际写入字节一致。S1 把这些工具内化为普通函数并停止注册（[S1 笔记](2026-08-21-dsh-segment-s1-semantic-capability.md)）。
- `tests/loader.spec.ts` 通过组合证明 headless profile 发现插件；`tests/keyless-smoke.e2e.ts` 在源码模式与构建后的 `lib/` 模式证明无凭据的真实 loader 启动。
- `README.md` 明确声明这是 S0 原型/参考骨架，不做任何生产科学能力声明。

S0 不包含 `InvestigationRun`/`dshSessionId` 持久化、Postgres 存储、lease/fencing/重试、Fargate 启动或回调、共享会话根/检查点/恢复、真实 provider（B2、TowerH、TowerT、VLM、CoTracker）或语义能力注册表。不修改 `flinter/aws-runtime`、`flinter/local-harness`、`flinter-data-infra`、`deploy/dsh-worker/DSH_COMMIT` 或 `~/.dsh` 凭据/配置。

## Alternatives considered

**为普通 `.js` spec 引入裸名导入 facade。** 已否决：harness 的 tsconfig path facade 经证明不适用于 `examples/` 下的普通 `.js` 模块；仓库惯例是已通过的 sibling spec 导入风格，随附测试即是照此办理。

**注入 `['tools', 'jobs']`。** 已否决：插件从不使用 `jobs`，无用的注入会让插件激活受制于 jobs 服务。

**loader/镜像 smoke 通过后立即把 `dsh-segment` 合并进 `aws-runtime`。** 已否决（charter §3A）：对外暴露的仍是原型原语，合并门槛是语义能力契约（S1），而不是 smoke 证据。

## Consequences

S0 是冻结的原型检查点：其中没有任何内容声称生产科学能力，镜像 smoke 仅是外部集成证据。S0 所述的下一个语义检查点已作为 [S1](2026-08-21-dsh-segment-s1-semantic-capability.md) 落地：语义能力适配器、最小能力注册表与契约测试；只有在该语义检查点通过后，才允许建立 integration 分支把 DSH 线与 `aws-runtime` 及其 AWS 附加能力结合，届时才可更新 `DSH_COMMIT`。本笔记须与已落地的 S0 事实（路径、schema、机制）在同一改动中保持同步更新。