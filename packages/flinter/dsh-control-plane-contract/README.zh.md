---
description: "面向 control-plane worker task 与 Beam compute request 的公开 DSH 集成合约。"
kind: "package-library"
---

# @deepseek-ai/dsh-control-plane-contract

[English](README.md) | 中文

本包冻结 DSH migration line 与现有 FLINTER control plane 之间的公开集成形状。
它携带 task、session、attempt identity 以及可选的 compute request。`beam`
是 executor/control plane 请求的能力，本包不会进行 provisioning。

control-plane roadmap、授权、durable lease、callback、AWS 部署、artifact 权威
和 rollback 仍由现有系统负责。本包只提供合约 fixture，不包含 credential 或
cloud state。
