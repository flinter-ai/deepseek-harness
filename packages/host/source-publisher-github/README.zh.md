---
description: "仅限 Host 的 Git worktree 与 GitHub Pull Request 发布器，用于接受浏览器源码草稿。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-source-publisher-github

[English](README.md) | 中文

## 概述

从干净的 request-scoped worktree 把已接受的源码草稿转换为 GitHub Pull Request。当 DSH Web 需要受控的 commit-back 路径时使用本 Host 包；浏览器提供文件和 revision 意图，Host 负责仓库访问、凭据、Git 检查和 PR API。

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

`@deepseek-ai/dsh-host-source-publisher-github` 是 source-draft flow 的可选 Host 部分。它从草稿精确的 `baseSha` 创建干净临时 worktree，只写入提交的相对文件， 运行 Git 检查，创建并推送生成的 branch，然后创建 GitHub Pull Request。

浏览器只会收到 branch、commit 和 PR URL。GitHub token 在发布时由部署拥有的回调解析 （Web 组合默认使用 `GITHUB_TOKEN`）；它不会接受来自浏览器草稿、memory MCP、prompt 或 Session 事件的 token。

默认 Web bundle 不启用此 publisher。需要把本包作为显式 Host row 加入，并设置 `owner`、`repo`；若部署只允许一个 checkout 发布，还应配置 repository allow-list。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Publisher 会在创建临时 worktree 前校验草稿 base，只应用经过验证的相对文件，并在提交前运行仓库 Git 检查。Token 在 Host 进程内解析，返回 branch、commit 和可选的 PR URL 元数据。浏览器和模型都不会收到 token。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Source controller](../../api/source-controller/README.zh.md)——草稿校验与发布 seam。
- [Workspace package](../../workspace/workspace/README.zh.md)——仓库与 worktree helper。
- [配置目录](../../../docs/config-catalog.zh.md)——生成的包元数据。

-----

<a id="model-experience"></a>
## 模型体验

### 人工 Pull Request 发布

#### 模型看到什么

不会直接看到。`GitHubSourcePublisher` 为人工源码编辑器创建 Git branch 和 Pull Request，不添加 prompt、消息内容、tool、schema 或模型可见 Session 事件。

#### Token 影响

没有影响；adapter 不会组装或发送 provider 请求。

#### KV Cache 影响

没有影响；Git 发布不会改变模型历史或 provider cache。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制和延期工作

- 本包不发布 runtime invariant companion，因为每次发布使用 request-scoped worktree 状态，不暴露包自有的后台关系。
- **仅支持 GitHub provider**——当前 adapter 面向 GitHub Pull Request API；GitLab、 Bitbucket 和 Azure DevOps 需要单独的 Host adapter。
- **凭据由部署拥有**——没有 `owner`、`repo` 和 Host token 环境时，默认 Web 组合保持 不活动；浏览器草稿不能启用发布或提供凭据。
- **不自动合并**——adapter 会创建并推送 PR branch，但不会批准、合并或部署该 PR。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
