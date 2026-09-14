---
description: "由持久 DSH 草稿和明确 Host 发布边界支持的面向用户 Sandpack 源码编辑器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-source-editor

[English](README.md) | 中文

## 概述

在 Sandpack 中编辑和预览项目文件，同时由 Host 保护持久草稿、revision 冲突和 Git 发布。当用户需要在 DSH Web 内进行源码编辑时选择此浏览器界面；它不运行 DSH compute，也不会接收仓库凭据。

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

source-editor 包为 Session header 增加项目文件编辑操作。它是浏览器编辑与预览 界面，不是计算后端：文件保存在框架无关的 `SourceDraftModel` 中，通过 Host source controller 保存，并且只有显式配置的 Host Git/PR publisher 才能发布。

在 Web bundle 中与 `@deepseek-ai/dsh-api-source-controller` 一起挂载插件。打开 操作时，它会为当前 Session 加载最新草稿，或从精确的 Git `HEAD` 建立初始版本。 保存是显式操作；本地 buffer dirty 或冲突时会禁用 Create PR。删除持久草稿后， 本地编辑器变更仍保持 dirty，因此不会静默丢失。

浏览器永远不会收到 Git 凭据，Sandpack 也不会创建 PR。Host publisher 由部署拥有； 没有仓库身份配置时会安全失败。

<a id="understand-the-implementation"></a>
## 理解实现

`SourceDraftModel` 串行化保存、围住 revision，并在不导入 React 或 Sandpack 的 情况下暴露 `idle`／`dirty`／`saving`／`saved`／`conflict`／`published` 状态。 `SourceEditorAction` 将该 model 适配到 Sandpack 代码编辑器和预览。源码草稿不是 DSH memory-plugin 记录：草稿文件和 revision 位于 source-draft store，可选的 memory MCP 仍然是面向模型的事实／决定层。

-----

<a id="further-exploration"></a>
## 进一步探索

- [源码草稿模型](../../core/source-draft-model/README.zh.md)——框架无关的编辑器状态。
- [源码 controller](../../api/source-controller/README.zh.md)——Host Remote 与草稿持久化。
- [Host GitHub publisher](../../host/source-publisher-github/README.zh.md)——可选的 PR 边界。

-----

<a id="model-experience"></a>
## 模型体验

### 人工源码编辑

#### 模型看到什么

不会直接看到。面向用户的 `SourceDraftModel` 编辑器会把草稿文件、revision 状态 和生成的 Pull Request URL 保存在 prompt、消息、tool 以及模型可见 Session 事件之外。

#### Token 影响

没有影响；编辑器不会组装或发送 provider 请求。

#### KV Cache 影响

没有影响；浏览器编辑和预览不会改变模型历史或 provider cache。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制和延期工作

- 本包不发布 runtime invariant companion，因为编辑器状态位于 component/model 实例中，不存在包自有的全局运行时关系。
- **仅限浏览器编辑器**——Sandpack 在浏览器中预览和编辑文件；它不运行 DSH worker， 也不替代 EC2/CodeSandbox 计算。
- **需要显式 Host 发布**——没有部署拥有的 GitHub publisher 时，Save 可用，但 Create PR 会安全失败。
- **只呈现冲突，不自动合并**——过期 revision 会进入 `conflict`，用户必须重新加载／ 协调后才能再次保存。
- **不访问 provider 凭据**——源码编辑、Sandpack 和 memory plugin 都不会收到 GitHub 或 model-provider key。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
