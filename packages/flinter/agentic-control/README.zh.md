---
description: "从原生 DSH session 状态到 FLINTER agentic-control 合约的公开适配器。"
kind: "package-library"
---

# @deepseek-ai/agentic-control

[English](README.md) | 中文

本包定义 DSH 原生 session/event runtime 与 FLINTER control consumer 之间的
Phase 2 窄接缝。它投影 session identity、最新事件游标、开放的 turn/step
状态以及明确的 control intent。

## 边界

- DSH 拥有 agent loop、session、events 和执行行为；
- PR #48 与 canonical control-plane roadmap 拥有持久 claim、lease、callback、
  授权和 worker lifecycle；
- 本适配器不持久化、不调用 control plane，也不推断科学语义；
- Agent Teams 与 Orca 不由本包替换。

投影保留 identity 与 cursor，但不会把 event payload 复制到 control record。
未知事件只推进游标，不被解释。
