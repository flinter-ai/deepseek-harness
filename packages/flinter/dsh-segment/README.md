---
description: "Public DSH boundary for the authoritative TowerT segment-v1 capability contract."
kind: "package-library"
---

# @deepseek-ai/dsh-segment

English | [中文](README.zh.md)

This package is the DSH-side boundary for `towert.segment.v1`. The scientific
contract remains authoritative in FLINTER data-infra's `segment-v1.schema.json`
and `segment-capability-contract.md`; this package does not reproduce that
schema or implement segmentation.

It validates and transports the contract's top-level status semantics:
`completed` may contain zero candidates, `partial` must declare missing
components, and `failed` must contain no candidates or classifications. It
also preserves the distinction between `UNKNOWN` and classifier abstention.

No model inference, artifact fetching, Tower authority, rubric routing, AWS,
B2, RDS, Beam, or storage behavior is included.
