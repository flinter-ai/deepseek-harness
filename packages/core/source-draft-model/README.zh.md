---
description: "供 Sandpack 和其他编辑器共享的框架无关源码草稿状态机。"
kind: "package-reference"
---
# @deepseek-ai/dsh-source-draft-model

[English](README.md) | 中文

<a id="summary"></a>
## 概述

本包提供浏览器源码编辑器使用的无 React `SourceDraftModel`。它串行化保存、围栏乐观 revision、跟踪 dirty 和 conflict 状态，拒绝发布未保存文件，并在持久化草稿删除后保留本地 dirty 文件。

## 目录

- [概述](#summary)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## 使用本包

为模型提供 `SourceDraftRemote` 实现和 Session/Git base，然后把 `getSnapshot()` 与 `subscribe()` 适配到任意编辑器框架。Sandpack 只是其中一种适配器；直接 DSH Web 编辑器或其他浏览器编辑器也能复用相同模型，而无需导入 React、Sandpack、Git 或 provider 凭据。

模型不会把草稿内容存入可选的 DSH memory MCP。持久化源码文件和 revision 属于 source-draft service；memory 仍是独立的、面向模型的事实与决定层。

<a id="model-experience"></a>
## 模型体验

### 人工源码编辑

#### 模型看到的内容

不会直接进入模型上下文。`SourceDraftModel` 协调人工编辑器缓冲区和 Host Remote，不添加 prompt、tool、消息、schema 或模型可见 Session 事件。

#### Token 影响

无；模型不会组装或发送 provider 请求。

#### KV Cache 影响

无；编辑器状态变化不会修改模型历史或 provider cache。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **不自动合并** — version conflict 会报告给编辑器；本包不会替竞争文件内容作选择。
- **由 Remote 持久化** — 模型是内存中的客户端状态机；注入的 `SourceDraftRemote` 必须提供持久化和发布能力。
- **不处理凭据** — GitHub、模型 provider 和 memory 凭据都留在本包之外。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
