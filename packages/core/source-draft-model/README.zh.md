---
description: "供 Sandpack 和其他编辑器共用的框架无关源码草稿状态机。"
kind: "package-reference"
---

# @deepseek-ai/dsh-source-draft-model

[English](README.md) | 中文

## 概述

让浏览器编辑器的文件和 revision 状态保持一致，使保存串行执行并让过期发布安全失败。当 Sandpack 或其他编辑器需要同一套草稿协议，又不应导入 React、Git、compute 或凭据时，使用这个框架无关的模型。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制和延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 何时选择

本包提供浏览器源码编辑器使用的无 React `SourceDraftModel`。它串行化保存、围住 乐观 revision、跟踪 dirty 与 conflict 状态、拒绝发布未保存文件，并在持久草稿被 删除后保留本地 dirty 文件。

提供一个 `SourceDraftRemote` 实现以及 Session/Git base，然后把 `getSnapshot()` 和 `subscribe()` 适配到任意编辑器框架。Sandpack 只是其中一个 adapter；直接运行 在 DSH Web 上的编辑器或其他浏览器编辑器也可以使用同一模型，无需导入 React、 Sandpack、Git 或 provider 凭据。

模型不会把草稿内容存入可选的 DSH memory MCP。持久源码文件与 revision 归 source- draft service 所有；memory 仍然是独立的面向模型事实与决定层。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

模型把本地文件快照与远端草稿 revision 分开保存。串行操作链防止保存互相覆盖，远端结果决定快照进入 saved、conflict 或 published 状态。模型只提供不可变快照；持久化、Git 和 provider 权限由注入的 Remote 与 Host composition 负责。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Source controller](../../api/source-controller/README.zh.md)——持久化 Host Remote 实现。
- [Source editor](../../client/ui-source-editor/README.zh.md)——Sandpack 浏览器适配器。
- [配置目录](../../../docs/config-catalog.zh.md)——生成的包元数据。

-----

<a id="model-experience"></a>
## 模型体验

### 人工源码编辑

#### 模型看到什么

不会直接看到。`SourceDraftModel` 协调人工编辑 buffer 与 Host Remote，不添加 prompt、 tool、消息、schema 或模型可见的 Session 事件。

#### Token 影响

没有影响；model 不会组装或发送 provider 请求。

#### KV Cache 影响

没有影响；编辑器状态变化不会改变模型历史或 provider cache。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制和延期工作

- 本包不发布 runtime invariant companion，因为它是纯 per-editor 状态机，不存在包 自有的全局运行时关系。
- **不自动合并**——版本冲突会呈现给编辑器；本包不会替用户选择竞争中的文件内容。
- **由远端负责持久化**——model 是内存中的客户端状态机；注入的 `SourceDraftRemote` 必须提供持久化与发布能力。
- **不处理凭据**——GitHub、model-provider 和 memory 凭据均留在本包之外。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
