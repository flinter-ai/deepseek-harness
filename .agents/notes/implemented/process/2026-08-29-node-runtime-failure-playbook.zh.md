# Agent Note: Node 运行时与本地失败处理手册

Status: implemented

[English](2026-08-29-node-runtime-failure-playbook.md) | 中文

## Problem

工作区声明的 Node 约束为 `^22.19.0 || >=24.0.0`，但一次本地推送使用了 Node `22.16.0`。该运行时低于支持的 Node 22 下限，并导致可选的 `unrun` 构建依赖在声明的构建和类型检查开始前加载失败。结果看起来像代码失败，实际首先出错的是 Node 可执行文件。

## Decision

仓库契约仍然是 `^22.19.0 || >=24.0.0`。Node 25 是有效的本地选择，但仓库不会用 Node 25 替换现有支持矩阵：CI 的主路径是 Node 24，兼容性下限仍是 Node 22.19。标准化的 `pre-commit` 和 `pre-push` hook 现在通过 [`scripts/verify-node-runtime.mjs`](../../../../scripts/verify-node-runtime.mjs) 快速失败，并在 TypeScript 或可选构建依赖加载前报告当前可执行文件。

## Failure classification

| 情况 | 重要性 | Hook 行为 | 正确响应 |
| --- | --- | --- | --- |
| 低于 `22.19` 的 Node，包括 `22.16` | P0 | 立即失败 | 选择 Node 24/25+ 或 Node 22.19+，确认 `node -v` 后重试 |
| 暂存 lint、空白、翻译配对或 vendor manifest 漂移 | P0 | pre-commit 修复或拒绝 | 应用安全修复、暂存生成结果，或修正暂存文件 |
| TypeScript/构建契约错误 | P0 | pre-push 拒绝 | 修复代码或依赖契约，不要绕过运行时检查 |
| Snapshot 或 expected 输出差异 | P1 | 不自动更新 | 检查语义差异，仅在行为有意且经过审查时更新 |
| 可复现的单元测试/E2E 失败 | P1 | 不隐藏 | 修复回归，或用证据记录阻塞 |
| Hosted runner 排队、provider 中断、缺少 secret 或平台专属失败 | P1 | 不是本地 hook 修复项 | 分类为 CI/环境证据，有理由才重跑，并保留失败记录 |
| 无关的 flaky 或资源竞争失败 | P2 | 不在 hook 中隐藏 | 隔离重跑，诚实记录 `NOT_RUN`、`BLOCKED` 或 `FAIL` |

## Pull-request check importance

“Non-blocking” 表示该检查不应阻止代码变更合并；不表示可以静默跳过底层测试。检查仍需可见，失败时仍需调查。

| 类别 | 检查 | 合并处理 |
| --- | --- | --- |
| Non-blocking / informational | Cloudflare preview 构建已通过但上传凭据缺失时的上传步骤；没有 provider secret 的 fork PR real-provider E2E；观察性和 benchmark job | 记录结果，不将其设为合并阻塞项。不要把跳过的 E2E 称为 provider 通过。 |
| Important / blocking | Node 24 static、coverage、snapshots/artifacts；Node 22.19 和 Node 26 兼容性；Windows build/native/coverage；Python contract checks；aggregate verdict | 必须通过，或有明确且经过审查的基础设施例外。不能仅因耗时长就跳过。 |
| Current exception | Windows native test job：四个文件通过，但 `workflow-worker-thread` 的 Vitest worker 意外退出 | 在隔离重跑证明是平台 flaky，或负责人记录明确策略决定前，继续作为阻塞项。 |
| Local hook scope | 运行时检查、暂存 lint、空白、翻译配对、vendor manifest；pre-push typecheck | Hook 保留便宜且确定的检查。本地 hook 不运行完整 coverage、snapshots、provider E2E 或云部署。 |

## Standard local sequence

1. 运行 `node -v`，确认可执行文件满足根目录的 `engines.node` 范围。
2. 优先使用主 CI 路径的 Node 24；Node 25 在明确选择时同样有效。
3. 切换运行时或修改 lockfile 后运行 `pnpm install --frozen-lockfile`。
4. 先运行最相关的窄测试，再在推送前运行 `pnpm run typecheck`。
5. 将本地绿色结果视为该运行时的证据；完整矩阵和平台门禁仍由 CI 负责。

Hook 只修复便宜且确定的缺陷，并拒绝契约错误；不会自动重写 snapshot、无限重试 provider/runner 失败，也不会把本地结果声明为云端或科学证据。

## Consequences

现在会在无效 Node 可执行文件产生误导性的 `tsx`、`unrun`、TypeScript 或构建错误前识别它。Hook 无法修改父 shell 的 `PATH`，因此选择 Node 仍是开发者或 CI 环境的明确动作；错误信息会显示可执行文件和支持的替代版本。Node 25 保留为本地可选偏好，Node 24 和 Node 22.19 保留为可验证的支持路径。

## Alternatives considered

- **强制所有地方使用 Node 25。** 不采用：Node 25 有效但不是仓库的 LTS 下限或 CI 主路径，强制它会移除有意保留的 Node 22.19/24 兼容契约。
- **允许 hook 在任意 Node 上运行并依赖 CI。** 不采用：Node 22.16 会在有意义的检查前失败，浪费推送并掩盖原因。
- **在 hook 中自动选择机器专属的 Node 路径。** 不采用：`nvm`、`asdf`、Homebrew 和 CI 安装路径不同；可移植的检查可以识别错误运行时，但不能安全地修改调用者的 shell 环境。
- **忽略可选依赖或 provider 失败。** 不采用：由不支持运行时导致的可选包加载失败是可修复问题，而 provider/hosted-runner 失败需要单独证据，不能用一揽子忽略处理。
