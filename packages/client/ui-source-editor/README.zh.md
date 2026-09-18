---
description: "由持久化 DSH 草稿和显式 Host 发布边界支持的 Sandpack 源码编辑器。"
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-source-editor

[English](README.md) | 中文

<a id="summary"></a>
## 概述

source-editor 包为 Sandpack 提供编辑项目文件的 Session header 操作。它是浏览器编辑和预览界面，不是计算后端：文件保存在框架无关的 `SourceDraftModel` 中，通过 Host source controller 保存，并且只有显式配置的 Host Git/PR publisher 才能发布。

## 目录

- [概述](#summary)
- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在 Web bundle 中与 `@deepseek-ai/dsh-api-source-controller` 一起挂载本插件。打开操作后会加载 Session 的最新草稿，或以精确的 Git `HEAD` 为基础创建草稿。保存是显式操作；本地缓冲区 dirty 或冲突时 Create PR 会被禁用。删除持久化草稿会保留本地编辑变化为 dirty，避免静默丢失。

浏览器不会获得 Git 凭据，Sandpack 也不会创建 PR。Host publisher 由部署负责配置；没有仓库身份时会安全失败。

<a id="understand-the-implementation"></a>
## 理解实现

`SourceDraftModel` 串行化保存、围栏 revision，并公开编辑器状态；`SourceEditorAction` 将其适配到 Sandpack 编辑器和预览。源码草稿属于 source-draft store，独立的 memory MCP 仍负责面向模型的事实与决定。

<a id="model-experience"></a>
## 模型体验

### 人工源码编辑

#### 模型看到的内容

不会直接进入模型上下文。编辑器会把草稿文件、revision 状态和 Pull Request URL 保存在 prompt、消息、tool 和模型可见 Session 事件之外。

#### Token 影响

无；编辑器不会组装或发送 provider 请求。

#### KV Cache 影响

无；浏览器编辑和预览不会改变模型历史或 provider cache。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **仅限浏览器编辑器** — Sandpack 在浏览器中预览和编辑文件，不运行 DSH worker，也不替代 EC2/CodeSandbox 计算。
- **需要显式 Host 发布** — 没有部署负责的 GitHub publisher 时，Save 可用，但 Create PR 会安全失败。
- **冲突需要人工协调** — 过期 revision 会变为 `conflict`，人工必须重新加载或协调后才能再次保存。
- **不接触 provider 凭据** — 源码编辑、Sandpack 和 memory plugin 都不会获得 GitHub 或模型 provider key。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
