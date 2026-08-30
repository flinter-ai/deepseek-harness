---
description: "Metadata-only linkage from native DSH SessionEvents to an existing FLINTER execution context."
kind: "package-library"
---

# @deepseek-ai/dsh-trace-link

English | [中文](README.zh.md)

This package is the Phase 2 trace-link seam. It consumes native DSH session
event references and emits the existing FLINTER `flinter.trace-link.v1`
contract. It carries identifiers, sequence, and producer provenance only.

It deliberately does not copy event payloads, model output, tool arguments,
scientific observations, Tower authority, or tenant decisions. DSH remains the
owner of canonical session events; FLINTER and Towers remain owners of
scientific semantics.

## Non-goals

- no second event codec or persistence store;
- no event interpretation or scientific inference;
- no cloud sink, AWS, B2, RDS, Beam, or deployment behavior;
- no Orca replacement or Agent Teams coordination.

Unknown or plugin event types are valid inputs to the reference adapter because
the adapter reads only `sessionId` and `seq`. Extra fields on a reference are
rejected so payloads cannot cross the boundary accidentally.
