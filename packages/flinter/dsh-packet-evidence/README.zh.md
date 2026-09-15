---
description: "独立的 DSH 插件，为 Ark 和其他 runner 提供有界 FLINTER packet evidence，同时让 Jacq 的物化保持在 host 侧。"
kind: "package-reference"
---

# @deepseek-ai/dsh-packet-evidence

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-packet-evidence` 把 FLINTER 的规范 packet-evidence 合约挂载到 DSH 组合中。它是 DSH package graph 中的独立包，因此 Ark、Jacq、Devin ACP 或其他 runner 都可以加载它，不需要把 Search-R1 工作树导入 runner。面向模型的调用只携带不透明的 `packet_id`、调用方选择的引用和明确的边界；配置的进程负责引用校验、来源校验和截断。Jacq 通过 host-only 的有界快照操作使用同一合约。本 MVP 每个请求启动一个子进程，不宣称真实 provider 已经运行。

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

把本插件挂载到拥有面向模型 agent 的 DSH 组合中。让它指向 Search-R1 的 `packet_registry_service.py` 进程，或者任何兼容 `packet-registry-service-v1` 的实现。受信任的 registry root 保留在 host 配置中，永远不会发送给模型。

### 何时选择

当 DSH runner 需要有界且可审计的证据访问，同时又不能把完整 trace 或文件系统路径放进 tool call 时，选择本包。对于能够继续请求证据片段的 Ark-style runner，使用动态工具。对于需要在运行前拿到快照的 Jacq-style 执行，使用 `PacketEvidenceClient.materializeJacq()`。Devin ACP 也可以使用同一个 client，或者以后接入 ACP adapter；本包不绑定某一种 runner。

### 最小配置

```ts
import PacketEvidence from '@deepseek-ai/dsh-packet-evidence'

await ctx.plugin(PacketEvidence, {
  command: 'python3',
  args: ['/path/to/packet_registry_service.py'],
  registryRoot: '/trusted/packet-registry',
  timeoutMs: 30_000,
  maxResponseBytes: 128_000,
})
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `command` | 必填 | 提供 `packet-registry-service-v1` 的可执行文件。 |
| `args` | `[]` | 插件追加受信任 registry-root 参数之前的参数。 |
| `registryRoot` | 必填 | host 侧规范 packet registry 根目录。 |
| `cwd` | `''` | 可选的 host 侧子进程工作目录。 |
| `timeoutMs` | `30000` | 每次请求的进程截止时间。 |
| `maxResponseBytes` | `128000` | 接受的 service 响应最大字节数。 |
| `toolPrefix` | `flinter_` | 面向模型的工具名称前缀。 |

生成的[配置目录](../../../docs/config-catalog.zh.md)是所有字段及其 JSDoc 的完整来源；从本包重新生成目录后会加入本包专属的 anchor。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部说明——点击展开</summary>

### 设计边界

Search-R1 进程是规范证据的 owner。本包是传输与 DSH presentation adapter：每个请求启动一个短生命周期子进程，发送一条小型 JSONL 消息，校验响应，并渲染有界 JSON tool result。本包不选择证据、不计算 packet identity、不读取源 trace，也不实现第二套截断算法。

### 源码索引

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 配置 schema、有界进程 client、DSH 工具注册以及 host-only Jacq 方法。 |
| [`src/invariant.ts`](src/invariant.ts) | DSH test host 使用的包级 invariant companion。 |
| [`tests/index.spec.ts`](tests/index.spec.ts) | 紧凑请求、进程边界、工具表面、超时和响应边界测试。 |
| [`tests/fixtures/packet-service.mjs`](tests/fixtures/packet-service.mjs) | 确定性的协议 fixture；它不是 provider 或证据实现。 |

公开的动态方法是 `packet_describe` 和 `evidence_get`。`materialize_jacq` 明确是 host-only：它为 Jacq 兼容性返回有界快照，但不作为模型工具暴露。请求保留调用方顺序和重复项；规范 service 负责稳定去重并应用自己的边界。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- 独立 FLINTER 仓库中的 Search-R1 packet registry service — 规范 packet 与证据语义。
- [Alpha profile](../dsh-alpha-profile/README.zh.md) — 可选的 DSH 组合与 worker 生命周期 profile。
- [DSH tools](../../core/tools/README.zh.md) — 面向模型的工具注册与结果呈现。
- [DSH ACP](../../acp/acp/README.zh.md) — 可以消费已挂载组合的自动化传输。

-----

<a id="model-experience"></a>
## 模型体验

### Packet evidence 工具

#### 模型看到什么

模型看到 `flinter_packet_describe` 和 `flinter_evidence_get`，其 JSON 参数包含不透明的 `packet_id`、可选证据引用以及明确的字符/条目边界。结果保留记录中的证据状态、来源和截断信息；有效的空结果仍然不同于 service error。完整 trace、manifest 路径、registry root、凭据和源 artifact 路径不会成为模型输入。

#### Token 影响

只有选定调用返回的有界 JSON result 会进入 Session。本插件不发送完整 trace，也不额外发起模型请求；子进程响应大小限制与证据字符限制相互独立。

#### KV Cache 影响

工具 schema 和短 guidance section 在组合的 Session 中保持稳定。只有模型调用工具时证据 result 才追加，因此在 DSH Session 改变工具表面或路由之前，未改变的前缀可以复用。

## 已知限制和延期工作

<a id="known-limitations-and-deferred-work"></a>

- **每次请求一个短生命周期子进程** — MVP 以隔离优先于持久连接；以后可以加入受监管的进程池，但不改变证据合约。
- **当前只有本地进程边界** — 这里没有实现 MCP、HTTP 或 SDK transport；它们应当包装同一组 `packet_describe` 与 `evidence_get` 操作。
- **没有 provider 结论** — 包测试使用确定性的协议 fixture，不证明 Ark、Jacq、Devin ACP、RDS、Octen 或真实模型可用。
- **需要规范 registry** — 配置的 service 必须解析 packet ID，并自行执行 source/hash 与证据边界校验。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本包应保留在 DSH 仓库中。不要复制 Search-R1 源码，不要链接 Search-R1 工作树，不要暴露原始 trace，也不要把 provider-specific adapter 代码移到 Search-R1 分支。下一个 transport adapter 应调用同一个配置 service，并保留 packet identity、source hash、view hash 与 truncation metadata。

</details>
