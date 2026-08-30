---
description: "Public executor and Runta adapter boundary for literal DSH task delivery."
kind: "package-library"
---

# @deepseek-ai/dsh-executor

English | [中文](README.zh.md)

This package defines the non-Orca executor boundary around the existing DSH
attempt-safety primitives. It validates literal task delivery, stable DSH
session identity, fresh attempt identity, and retry lineage.

The package does not launch workers, create worktrees, persist leases, fence
processes, or call AWS. Those behaviors belong to the Runta/control-plane
implementation and require their own integration evidence.
