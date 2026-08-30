---
description: "Public DSH integration contracts for control-plane worker tasks and Beam compute requests."
kind: "package-library"
---

# @deepseek-ai/dsh-control-plane-contract

English | [中文](README.zh.md)

This package freezes the public integration shape between the DSH migration
line and the existing FLINTER control plane. It carries task/session/attempt
identity and an optional compute request. `beam` is a capability requested by
the executor/control plane; this package does not provision it.

The control-plane roadmap, authorization, durable leases, callbacks, AWS
deployment, artifact authority, and rollback remain owned by their existing
systems. Values here are contract fixtures only; no credentials or cloud
state are included.
