---
description: "Public DSH-side searchable-trace contract seam with bounded, tenant-scoped references."
kind: "package-library"
---

# @deepseek-ai/dsh-pes

English | [中文](README.zh.md)

This package is the DSH-side contract seam for searchable trace records. The
authoritative persistence implementation remains FLINTER data-infra's
`searchable-trace-store` and `searchable-trace-service`.

The seam permits only a bounded summary and an immutable artifact reference.
Record identity is deterministic for organization, investigation run, and
ordinal. Re-delivery must be idempotent; divergent content is a conflict.
Queries require an organization boundary and never return cross-tenant data.

No database driver, artifact download, B2/RDS deployment, AWS state, or
scientific result authority is included.
