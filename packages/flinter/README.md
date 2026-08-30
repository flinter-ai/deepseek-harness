---
description: "Package map for FLINTER's DSH alpha integration layers and future downstream capability adapters."
kind: "package-group"
---

# flinter/ — FLINTER DSH integration

English | [中文](README.zh.md)

## Summary

The `flinter/` group contains FLINTER-owned composition layers over the pinned DeepSeek Harness alpha. The profile package defines provider, credential-reference, model-capacity, reasoning, and worker-launch seams; future trace, control, segment, PES, and executor packages will consume native DSH contracts one at a time. DSH remains authoritative for the agent loop, sessions, tools, providers, and credentials. This group does not replace the control plane, Tower scientific semantics, Runta execution, or the preserved Orca integration.

## Packages

| Package | Role | Status |
|---|---|---|
| [`dsh-alpha-profile/`](dsh-alpha-profile/README.md) | Phase 1 provider/profile and control-plane worker seam over alpha | active Phase 1 implementation |

Future package rows are added only when their own component and local E2E gates are accepted.

## Related documentation

- [DSH agent and session subsystem](../../docs/subsystems/core.md) — the DSH runtime boundary this group composes.
- [Credential subsystem](../../docs/subsystems/credentials.md) — the credential-provider boundary; this group carries references, never secret values.
- [LLM streaming subsystem](../../docs/subsystems/llm-streaming.md) — the provider/stream contract consumed by profile routes.

## Known Limitations and Deferred Work

- **Downstream packages are not ported yet** — trace-link, agentic-control, segment, PES, executor/Runta, and cloud integrations remain later migration phases.
- **The profile is not production cutover evidence** — local and mock-provider tests do not prove live AWS, provider, Tower, Beam, or control-plane behavior.
