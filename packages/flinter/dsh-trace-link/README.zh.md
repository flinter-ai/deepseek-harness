---
description: "从原生 DSH SessionEvents 到现有 FLINTER execution context 的公开、仅元数据链接适配器。"
kind: "package-library"
---

# @deepseek-ai/dsh-trace-link

[English](README.md) | 中文

这是 Phase 2 的 trace-link 接缝层。它消费原生 DSH SessionEvent 引用，并
生成现有 FLINTER `flinter.trace-link.v1` 合约。它只携带标识符、序号和
生产者溯源信息。

它不会复制事件 payload、模型输出、工具参数、科学观测、Tower 权威或
租户决策。DSH 仍然拥有规范 SessionEvents；FLINTER 和 Towers 仍然拥有
科学语义。

本包不包含第二套事件 codec、持久化、云 sink、AWS、B2、RDS、Beam、部署、
Orca 替换或 Agent Teams 协调逻辑。

## 非目标

- 不提供第二套事件 codec 或持久化存储；
- 不解释事件，也不进行科学推断；
- 不提供云 sink、AWS、B2、RDS、Beam 或部署行为；
- 不替换 Orca，也不负责 Agent Teams 协调。
