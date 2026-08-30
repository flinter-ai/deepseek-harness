---
description: "面向字面 DSH task delivery 的公开 executor 与 Runta 适配器边界。"
kind: "package-library"
---

# @deepseek-ai/dsh-executor

[English](README.md) | 中文

本包定义现有 DSH attempt-safety 原语之上的 non-Orca executor 边界。它验证
字面 task delivery、稳定的 DSH session identity、全新的 attempt identity
以及 retry lineage。

本包不启动 worker、不创建 worktree、不持久化 lease、不执行 process fencing，
也不调用 AWS。这些行为属于 Runta/control-plane 实现，并需要独立集成证据。
