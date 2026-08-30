---
description: "Public adapter from native DSH session state to FLINTER agentic-control contracts."
kind: "package-library"
---

# @deepseek-ai/agentic-control

English | [中文](README.zh.md)

This package defines the narrow Phase 2 seam between DSH's native session/event
runtime and FLINTER control consumers. It projects session identity, the latest
event cursor, open turn/step state, and explicit control intents.

## Boundaries

- DSH owns the agent loop, sessions, events, and execution behavior.
- PR #48 and the canonical control-plane roadmap own durable claims, leases,
  callbacks, authorization, and worker lifecycle.
- This adapter does not persist state, call a control plane, or infer science.
- Agent Teams and Orca are not replaced by this package.

The projection is intentionally lossless with respect to identity and cursor,
but it does not copy event payloads into a control record. Unknown event types
advance the cursor without being interpreted.
