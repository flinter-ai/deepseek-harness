# Agent Note: DSH attempt runtime safety

Status: implemented

[English](2026-08-29-dsh-attempt-runtime-safety.md) | 中文

## Problem

alpha worker adapter 提供了持久的 DSH session identity 以及 create/resume 语义，但 replacement worker 仍然需要 launch transport、文件系统隔离、manifest、fencing 和 canary 规则。复用旧 Orca worker home 要么会丢失 native DSH session continuity，要么会让可变的 attempt state 在 retry 之间共享。

## Decision

FLINTER alpha profile 在 worker adapter 旁边提供非 Orca safety layer。`buildDshAttemptLaunch()` 将 task 作为 literal argument 传给 direct child process，并构造 scrubbed environment。`resolveWorkerAttemptRoots()` 和 `createWorkerAttemptRoots()` 保留 control-plane 提供的 `DSH_SESSION_ROOT`，同时创建全新的 owner-only attempt 和 artifact 根目录；`writeWorkerAttemptManifest()` 通过 exclusive creation 记录一条不含 secret 的 launch record。`cleanupWorkerAttempt()` 只有在获得 terminal executor proof 后才会移除这些临时根目录，并且不会跟随 symlink。`assertCurrentWorkerCallback()` 将 current lease 和 attempt identity 用作 logical fence，而 `fenceWorkerAttempt()` 要求注入的 executor 在收到 stop 请求后报告 terminal state。`assertWorkerCanaryProof()` 要求 startup、literal task receipt、session persistence、accepted callback 和 recorded completion 全部完成后才允许 fan-out；artifact production 是条件性的。

这一层明确不负责 callback authentication、AWS/Beam task 的 placement 或 stop，也不解析 provider stderr。这些分别属于 control-plane/executor 和 DSH 的 ownership boundary。只有 executor fence 完成，且新的 launch 携带相同 DSH session identity 以及递增的 lease 和 attempt 字段后，worker replacement 才能开始。

## Alternatives considered

**每次 retry 都创建新的 DSH home。** 这能保持物理隔离，但会破坏 alpha adapter 的 same-session resume contract。实现改为在一个持久 DSH session 根目录周围隔离临时 attempt 根目录。

**在固定 script 后继续保留 shell interpolation。** task 仍会暴露给 shell parsing 和 quoting regression。实现使用 direct argv transport，并测试 shell metacharacters 和 substitutions 会作为 literal data 传递。

**让 launcher 根据 stderr 字符串推断 retry。** provider failure 属于 DSH model/API recovery，worker failure 属于 control plane。这个 library 中加入字符串分类会混淆 ownership，并使 replacement policy 失去 authority。

**把 coordinator timeout 当作 process fence。** timeout 不能证明 executor 已停止旧 computation。因此 replacement 必须等待注入的 terminal-state observation。

## Consequences

native DSH JSONL persistence 在 replacement attempt 之间保持连续，而 scratch、artifact 和 launch metadata 在物理上隔离，并且不能被相同 attempt identity 复用。manifest 提供不含 callback URL 或 secret reference 的 audit record。logical stale-callback rejection 和 physical executor fencing 可以独立测试，但 cloud proof 和 authenticated callback evidence 在 control-plane integration 存在前仍为 `NOT_RUN`。

canary contract 比 process exit success 更严格，并且在任一 required observation 缺失时有意阻止 fan-out。这个 package 本身不会启动 executor、发送 callback 或推进 authoritative control-plane state。
