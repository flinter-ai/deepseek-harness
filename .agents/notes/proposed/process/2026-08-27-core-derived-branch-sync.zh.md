# Agent Note: 将 core 同步到派生 DSH 分支

Status: proposed

[English](2026-08-27-core-derived-branch-sync.md) | 中文

## 问题

共享的 DSH 集成线是 `flinter/core`，而 local-harness、dsh-segment 和 aws-runtime 还分别承载 profile 或能力特有的改动。Git 分支指针不会继承后续提交，因此共享修复可能在派生运行时中缺失，却没有明显的同步记录。AWS 还把运行时特有提交与一份 segment 能力快照组合在一起，因此 core 更新不能掩盖独立的 dsh-segment 漂移。

## 提案

`Sync core to derived branches` 工作流监听对 `flinter/core` 的推送，也支持手动触发。它会从 `flinter/core` 向以下派生分支分别创建或复用草稿拉取请求：

- `flinter/local-harness`，用于本地 DeepSeek profile；
- `flinter/dsh-segment`，用于 segment 工作流能力线；
- `flinter/aws-runtime`，用于 AWS 运行时组合。

工作流不会强制推送或自动合并。独立的兼容性检查会比较 `flinter/aws-runtime` 与 `flinter/dsh-segment`，运行本地 `git merge-tree` 检查，并在 segment 分支存在 AWS 缺少的提交或两个分支的最新提交存在文本合并冲突时发出 GitHub Actions 警告。AWS core 同步拉取请求也会在正文中重复历史漂移警告，并说明 segment 能力的协调仍是独立工作。

`flinter/dsh-orca-plugin` 没有被加入这组派生分支，因为它当前的历史不是建立在最新 `flinter/core` 线上。它的对齐以及消费者 package 更新仍需单独决定。

## 考虑过的替代方案

**依赖分支祖先关系。** 祖先关系只能记录历史，不能在 `flinter/core` 前进时移动派生分支。

**自动把 core 合并到每个派生分支。** 自动合并可能掩盖 profile 特有代码或能力特有代码中的冲突。草稿拉取请求保持差异可见，并要求目标检查和审查。

**把 AWS 当成 dsh-segment 的复制品。** AWS 有自己的运行时集成改动，并消费能力输出；警告与独立的集成改动可以保留这一权限边界。

**把 segment 协调放进 core 同步拉取请求。** 这会把共享基础同步和能力交付混在一起，也无法清楚说明 AWS 是否真的包含 segment 线。工作流报告漂移，但不合并这些改动。

## 验收标准

- 推送到 `flinter/core` 时工作流运行并检查三个派生分支。
- 落后于 core 的目标只收到一个可复用的草稿同步拉取请求，不会重复创建。
- 已经包含 core 的目标不会产生不必要的拉取请求。
- AWS/dsh-segment 提交漂移或文本合并冲突会产生可见的工作流警告；如果存在 AWS 同步拉取请求，历史漂移警告也会出现在拉取请求正文中。
- 工作流不会自动合并、强制推送、更新 package pin 或解决 dsh-segment 漂移。

## 风险

工作流需要仓库允许 `GITHUB_TOKEN` 创建拉取请求。由该 token 创建的拉取请求可能需要仓库级 Actions 设置或手动重新运行检查，才能执行所有下游的拉取请求工作流。冲突仍然只是可审查的同步拉取请求，不能证明这些分支可以互换。
