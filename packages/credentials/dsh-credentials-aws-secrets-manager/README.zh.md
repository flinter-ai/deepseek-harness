---
description: "固定 DeepSeek Harness alpha 的公开 AWS Secrets Manager 凭据引用 provider，默认只读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-credentials-aws-secrets-manager

[English](README.md) | 中文

## 概述

这是固定 DSH alpha 的公开 AWS 凭据来源适配器。它和本地 provider 实现相同的 `ctx.credentials` 引用 seam。DSH 设置只携带 `ARK_PLAN_API_KEY` 这类名称；适配器在请求时解析对应的 AWS Secrets Manager 值。本包不保存机密值、AWS 账户、私有 endpoint 或部署凭据。

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

在 AWS worker profile 中禁用 base profile 的本地凭据行，然后挂载本 provider：

```yaml
- id: credentials
  disabled: true
- insert:
    - id: credentials-aws-secrets-manager
      name: '@deepseek-ai/dsh-credentials-aws-secrets-manager'
      config:
        secretNames:
          ARK_PLAN_API_KEY: flinter/dsh-ark-agent-plan
          MODELFLARE_API_KEY: flinter/dsh-modelflare
          GMI_SERVING_API_KEY: flinter/dsh-gmi-serving
          DEEPSEEK_API_KEY: flinter/dsh-deepseek-official
        secretFormat: json
        allowWrites: false
```

上面的名称是公开路由元数据。机密内容只由 AWS Secrets Manager 提供。JSON secret 使用引用名作为字段：

```json
{"ARK_PLAN_API_KEY": "<value supplied outside this repository>"}
```

默认 profile 为只读。`resolve` 和 `describe` 通过 AWS SDK 标准凭据链在请求时读取。除非经过单独审查并明确启用 `allowWrites`，否则 `set` 和 `unset` 会安全失败。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `region` | AWS SDK 链 | 可选 AWS 区域覆盖。 |
| `secretPrefix` | `/dsh/` | 未映射引用使用的后备前缀。 |
| `secretNames` | `{}` | 公开的引用到 secret 名称映射。 |
| `secretFormat` | `json` | `json` 选择字段；`plain` 使用整个字符串。 |
| `jsonField` | 引用名 | 可选的统一 JSON 字段覆盖。 |
| `allowWrites` | `false` | 只在明确审查后启用破坏性的 `set`/`unset`。 |

<a id="understand-the-implementation"></a>
## 理解实现

provider 只负责 AWS 后端的引用查询。DSH 仍负责 agent loop、Session、原生事件、模型/提供方选择和请求组装。FLINTER alpha profile 负责路由到 secret 名称的映射。因此本地 `tod` 和 AWS worker 使用同一套 DSH 安装与路由引用；只有凭据 provider 行发生变化。

记录型凭据操作在本适配器中明确不支持。provider 所有者的授权记录仍留在其专属存储中；Phase 1 的 AWS seam 只服务模型 API key 引用。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | AWS 引用解析、公开映射配置、只读保护与生命周期。 |
| [`src/invariant.ts`](src/invariant.ts) | 静态 invariant companion，不注册读取机密的运行逻辑。 |
| [`tests/aws-secrets-manager.spec.ts`](tests/aws-secrets-manager.spec.ts) | SDK mock 合约测试，不使用 AWS 账户或真实 secret。 |

<a id="further-exploration"></a>
## 进一步阅读

- [凭据引用 seam](../credentials/README.zh.md) — 本包实现的 DSH API。
- [本地凭据 provider](../credentials-local/README.zh.md) — 本地 `tod` 后端和文件语义。
- [FLINTER alpha profile](../../flinter/dsh-alpha-profile/README.zh.md) — 共享路由与 worker 组合。
- [AWS SDK 凭据链](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html) — 外部运行时认证配置。

<a id="model-experience"></a>
## 模型体验

### 模型看到什么

没有变化。模型收到由原生 Session 和选定路由组装的正常 DSH 请求。provider 请求使用解析出的值，但机密值不会写入 Session 事件流或模型上下文。

### Token 影响

没有影响。本包不增加 prompt 文本或上下文记录。

### KV Cache 影响

没有影响。凭据轮换只改变下一次请求的授权，不改变规范 Session 历史。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制和延期工作

- **Phase 1 只有 mock 证据** — 测试证明适配器合约，不声称已完成 AWS 部署或 IAM 证明。
- **没有外部轮换事件** — Secrets Manager 不提供本地文件 watcher 的更新事件；下一次请求会解析当前值。
- **仅支持引用** — plugin 的记录型授权仍不在本适配器范围内。
- **alpha profile 不写 AWS 状态** — profile 设置 `allowWrites: false`；部署写权限需要后续明确审查。

<a id="dev-note"></a>
### 开发备注

本包有意保持公开，并在组合边界使用 provider-neutral 设计。机密值、账户标识、IAM policy、私有 endpoint 和环境转储必须留在 Git、测试、日志与证据产物之外。
