---
description: "用于保存带版本的源码草稿，并把已接受的变更交给宿主发布器的 Host 与浏览器 API。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-source-controller

[English](README.md) | 中文

## 概述

通过一个 Host API 保存完整的浏览器文件快照，并且只发布 Host 接受的 revision。Sandpack、直接运行在 DSH Web 上的编辑器和其他客户端可以共用同一套草稿协议。当 Host 需要执行路径、revision、Session 身份和 publisher 边界时选择此 seam；草稿不会存入 memory plugin。

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

`@deepseek-ai/dsh-api-source-controller` 是浏览器源码草稿共用的 Host/Client 接口。Sandpack 和直接运行在 DSH Web 上的编辑器使用同一个 Remote API；Host 负责持久化草稿、版本围栏、路径限制和 Session 生命周期校验。

Client 包还导出不依赖 React 的 `SourceDraftModel` 编辑器适配器。Sandpack 或其他编辑器只需把完整文件快照交给它，显式调用 `save()`，并订阅不可变快照即可获得 `dirty`、`conflict`、`saved` 和 `published` 状态。`publish()` 会拒绝尚未保存的本地文件，避免 UI 意外发布过时缓冲区。

`SourceDraftModel` 有意不等同于 DSH memory plugin。草稿文件和 revision 状态只保存在 `source_drafts` storage domain 中，不会复制到 MCP memory、Session 日志、prompt 或模型可见的 tool。需要模型记住的项目事实或决定，应另外使用可选的 memory MCP。

### 最小配置

将 controller 与负责草稿 domain 的 storage 和 Session service 一起挂载。本包没有自有的凭据配置。

```yaml
- name: '@deepseek-ai/dsh-api-source-controller'
```

```ts
const model = new SourceDraftModel(ctx.sourceDrafts, {
  sessionId,
  baseSha,
  files: sandpackFiles,
})

model.setFiles(nextSandpackFiles)
await model.save()
await model.publish()
```

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Controller 会校验并规范化相对源码路径，执行文件数和字节数限制，并按 Session 身份保存不可变草稿记录。Remote client 为 bootstrap、save、delete 和 publish 使用同一套结果词汇。发布是注入的 Host seam；没有 publisher 时，controller 返回带类型的失败，不会尝试 Git 或 PR 操作。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [框架无关的草稿模型](../../core/source-draft-model/README.zh.md)——编辑器状态与 revision 围栏。
- [Host GitHub publisher](../../host/source-publisher-github/README.zh.md)——可选的 Host PR 创建边界。
- [配置目录](../../../docs/config-catalog.zh.md)——生成的字段参考。

-----

## Model Experience

### 浏览器源码草稿

#### What the model sees

不会直接进入模型上下文。`sourceDrafts` 将浏览器编辑状态保存在 Session 日志之外，不添加 prompt、tool 或模型事件；只有显式挂载的 `SourcePublisher` 才可能把已接受的草稿转换为 Host 侧 Git 操作。

#### Token effect

草稿操作为零。文件内容、revision 和发布结果不会由本包插入模型请求。

#### KV Cache effect

独立。保存或发布浏览器源码草稿不会改变模型请求前缀，也不会使 provider cache 失效。

## Known Limitations and Deferred Work

- 本包不发布 runtime invariant companion，因为 controller 负责 storage 与发布 seam，但不拥有需要 invariant registry 额外检查的可变运行时关系。
- 默认 web bundle 不挂载 Git/PR publisher；在 EC2 或其他 Host 组合专用 publisher、worktree 和凭据策略之前，`publish` 会返回 `publisher-unavailable`。浏览器草稿会拒绝密钥和仓库元数据路径。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
