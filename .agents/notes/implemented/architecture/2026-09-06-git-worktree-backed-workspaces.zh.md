# Agent Note: Git worktree-backed DSH workspaces share one handle

Status: implemented

[English](2026-09-06-git-worktree-backed-workspaces.md) | 中文

## Problem

目录分组为宿主消费方提供了稳定路径与会话账本，但 coding session 需要更强的 owner：terminal、editor、skills、code-memory、InstaCloud 与 GitHub/PR 集成必须共同指向一个隔离 checkout，不能各自选择共享 repository 目录。

## Decision

`@deepseek-ai/dsh-workspace` 同时支持现有的 directory-backed record 与 Git worktree-backed record。`WorkspaceRegistry.createWorktree()` 解析 source repository 与 base commit，在配置的 `worktreeRoot` 下（默认位于解析后的 DSH home 下）创建一个生成的 branch 与 worktree，并把 repository root、branch 与创建 commit 持久化在规范 workspace path 旁。

每个 `Workspace` 都暴露冻结的 `WorkspaceHandle`，其中包含稳定 id、规范 path 与可选 Git metadata。`handleFor()` 与 `resolvePath()` 让宿主 adapter 在解析绝对或相对路径前验证同一个 workspace。`resumeWorktree()` 验证持久化的 repository 与 branch，不改写 dirty file 或用户 commit；删除注册记录绝不删除 worktree。

## 实现边界

本 slice 已将 handle 接入 session create/fork、terminal、local file-reference 与 skill adapter。Editor、code-memory、InstaCloud 与 GitHub/PR adapter 在本 checkout 中不存在，仍为 `NOT_RUN`；本记录不声称存在 provider、PR、deployment 或 live-runtime 集成。

Git adapter 使用基于 argv 的 `execFile('git', argv)` 调用，拒绝不安全的 revision 与 branch，通过 Git common directory 验证 linked worktree 的 repository identity，并在注册失败时只回滚新创建且干净的 worktree。进程内串行 lease 允许每个 worktree 同时只有一个 active session；session create 与 fork 会 claim，`session/disposed` 会 release。Directory-backed workspace 绕过 lease 路径。

## Alternatives considered

**继续使用一个共享 repository 目录。** 这保留旧的路径分组，但会让并发 coding session 修改同一个 checkout，也无法验证 adapter 级别的 ownership。

**为 worktree 新建第二个 workspace registry。** 这会重复持久顺序、会话成员资格、存储恢复与宿主 wiring。扩展现有 registry 同时保留 directory 兼容性，并让两种形式共用一个 identity owner。

**通过插值的 Git 命令执行 shell。** shell parsing 会让 repository path、branch 与 revision 暴露于 quoting 与 injection 错误。adapter 将每个值作为独立 argv 元素传递。

**在普通删除或恢复时强制删除 worktree。** 删除是注册操作，而恢复无法证明磁盘上的 worktree 仍可安全丢弃。只有 create 操作自己创建的干净 worktree 才可回滚；用户 worktree 保持不变。

## Consequences

宿主集成可以在 workspace-aware 操作之间传递一个不可变 handle，而现有 directory-only caller 保持当前行为。`resolvePath()` 强制 lexical 包含并支持尚不存在的路径；会跟随现有符号链接的 adapter 必须自行执行 canonical target 策略。每个 workspace 的 branch 与 path 都相互隔离，但进程内 lease 有意不协调独立 DSH process；未来的跨进程 lease 需要独立的持久 ownership 机制。中断的 create 可能留下未注册的 Git worktree，交由人工清理，以避免冒险删除用户数据。

workspace package 增加 filesystem 与 Git 依赖，并提供可配置的 worktree root。Git/provider/deployment 行为仍然是本 package 之外的本地职责；workspace handle 不代表 cloud checkout、PR 或 live runtime proof。
