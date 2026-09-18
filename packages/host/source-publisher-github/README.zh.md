---
description: "源码草稿流程中可选的 GitHub Host 发布适配器。"
kind: "package-reference"
---
# DSH GitHub source publisher

[English](README.md) | 中文

<a id="summary"></a>
## 概述

`@deepseek-ai/dsh-host-source-publisher-github` 是 source-draft 流程中可选的 Host 部分。它从草稿的精确 `baseSha` 创建干净临时 worktree，只写入提交的相对文件，运行 Git 检查，提交并推送生成的 branch，然后创建 GitHub Pull Request。

浏览器只收到 branch、commit 和 PR URL。GitHub token 由 Host 在发布时通过部署负责的回调解析，不会接受来自浏览器草稿、memory MCP、prompt 或 Session event 的 token。

默认 Web bundle 不启用此 publisher。需要以 `owner` 和 `repo` 显式添加 Host row，并在部署只允许一个 checkout 时配置 repository allow-list。

## 目录

- [概述](#summary)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## 模型体验

### 人工 Pull Request 发布

#### 模型看到的内容

不会直接进入模型上下文。`GitHubSourcePublisher` 为人工源码编辑器创建 Git branch 和 Pull Request，不添加 prompt、tool、消息内容、schema 或模型可见 Session event。

#### Token 影响

无；适配器不会组装或发送 provider 请求。

#### KV Cache 影响

无；Git 发布不会改变模型历史或 provider cache。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **仅支持 GitHub** — 当前适配器面向 GitHub Pull Request API；GitLab、Bitbucket 和 Azure DevOps 需要独立 Host 适配器。
- **凭据由部署负责** — 默认 Web composition 只有在配置 `owner`、`repo` 和 Host token 环境后才启用；浏览器草稿不能启用发布或提供凭据。
- **不自动合并** — 适配器创建并推送 PR branch，但不会批准、合并或部署该 Pull Request。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
