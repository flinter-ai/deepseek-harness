---
description: "与本地 tod 使用相同 DSH alpha 组合的公开只读 AWS 凭据 profile 层。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-aws-worker-profile

[English](README.md) | 中文

## 概述

这是公开的 AWS worker profile bundle，连接到与本地 `tod` 相同的 DSH alpha 组合。它只做一件事：禁用 base profile 的本地凭据 provider，并以只读模式插入 `@deepseek-ai/dsh-credentials-aws-secrets-manager`。Harness、Agent、Session、模型/提供方路由、工具、原生事件和持久化仍由 DSH 负责。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制和延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把本 bundle 安装到已经包含 `@deepseek-ai/dsh-base` 和 `@deepseek-ai/dsh-headless` 的 source-checkout profile：

```sh
pnpm dsh plugin --profile headless add ./packages/flinter/dsh-aws-worker-profile
```

bundle 的 patch 只包含公开的 secret 名称映射。Secret 内容、AWS 凭据、区域、账户标识和 IAM policy 由运行环境在本仓库之外提供。仅安装 bundle 不会联系 AWS。

<a id="understand-the-implementation"></a>
## 理解实现

运行内容是 [`cordis.patch.yml`](cordis.patch.yml)。它替换一个 `credentials` 行并插入一个公开 AWS provider 行。不包含第二套 base bundle、CLI、Agent 或 Session 实现。

| 文件 | 作用 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 标准 DSH bundle 之上的精简 profile overlay。 |
| [`src/index.ts`](src/index.ts) | 空模块入口；运行内容是 patch。 |
| [`src/invariant.ts`](src/invariant.ts) | 不读取机密的静态 invariant companion。 |
| [`tests/profile.spec.ts`](tests/profile.spec.ts) | 验证公开元数据、映射与没有占位 secret 材料。 |

<a id="further-exploration"></a>
## 进一步阅读

- [AWS 凭据 provider](../../credentials/dsh-credentials-aws-secrets-manager/README.zh.md) — 请求时的引用解析。
- [FLINTER alpha profile](../dsh-alpha-profile/README.zh.md) — 共享路由、context、reasoning、worker 和 attempt 合约。
- [Base bundle](../../bundle/base/README.zh.md) — 本层修改的 DSH 组合。

<a id="model-experience"></a>
## 模型体验

### 模型看到什么

与本地 `tod` 相同的原生 DSH Session、system prompt、工具和 provider 路由。Secret 值只用于请求授权，不会进入 Session 事件或模型上下文。

### Token 影响

没有影响。本 bundle 不增加 prompt 文本或 context 记录。

### KV Cache 影响

没有影响。更换凭据来源不改变规范 Session 历史。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制和延期工作

- **Phase 1 只有 mock 证据** — 本 bundle 测试不证明 AWS SDK 调用或 IAM 权限。
- **默认只读** — secret 写入需要单独审查的部署配置。
- **尚未移植下游** — trace-link、agentic-control、segment、PES、executor/Runta、Tower、Beam 和控制平面集成仍是后续 gate。

<a id="dev-note"></a>
### 开发备注

所有 secret 值、账户标识、私有 endpoint、IAM 文档、环境转储和 AWS 运行证据都必须留在这个公开源码包之外。
