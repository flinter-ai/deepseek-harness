---
description: "面向 DSH 的有界确定性推理证据库。"
kind: "package-reference"
---

# @deepseek-ai/dsh-reasoning-bank

[English](README.md) | 中文

本软件包提供进程内 FIFO 证据库，用于保存已接受的轨迹元数据和有界证据 ID。它按轨迹身份去重，并支持确定性文本搜索。可选的函数插件通过 `ctx.provide` 使用 `flinterReasoningBank` 服务键；调用方通过 `ctx.get()` 读取可选服务。

只保留 ID、轨迹类型、生产者 SHA、运行序号、有界摘要、提示/经验文本和有界证据 ID。完整负载、提示词、思维链、秘密和媒体不属于可接受字段，也永远不会保存。

```ts
import { apply, Config, inject, name, type ReasoningBank } from '@deepseek-ai/dsh-reasoning-bank'

await ctx.plugin({ name, inject, Config, apply }, { enabled: true, maxEntries: 128 })
const bank = ctx.get('flinterReasoningBank') as ReasoningBank
bank.ingest(metadata, { status: 'completed', abstained: false, evidenceIds: ['event-1'] })
```

测试覆盖边界、去重、FIFO 淘汰、搜索、错误证据拒绝、服务注册和释放。本软件包是仅供宿主使用的接缝：当前 DSH master 没有自我改进消费者或持久化推理库后端，因此加载它不会改变已发布的默认组合，也不声明提供商或生产持久化能力。

## Model Experience

### 为宿主消费者保留的已接受轨迹元数据

#### What the model sees

模型不会直接看到任何内容。证据库是仅供宿主使用的服务，不注册提示词、工具 schema 或模型请求内容。未来的自我改进消费者可以通过该服务查询有界摘要和证据 ID，但任何面向模型的投影都由该消费者负责。

#### Token effect

直接增加零 token。写入或搜索条目不会向当前 DSH 请求追加文本；未来消费者的提示词或辅助请求属于其自身契约。

#### KV Cache effect

不会直接使缓存失效：本软件包不贡献请求 token，也不修改请求前缀。只有另行加载且渲染证据库结果的消费者才会改变下一个请求。

## Known Limitations and Deferred Work

- **进程内保留**——宿主进程结束后条目消失；持久化、跨 worker 同步和重放属于独立的集成接缝。
- **本软件包不连接轨迹发射器**——当前轨迹生产方必须明确选择已接受的元数据并调用 `ingest`；原始轨迹、负载、提示词、思维链、秘密和媒体不属于本契约。
- **尚未提供自我改进消费者**——该服务可供后续控制器或推理复核插件使用，但不会自动改变策略或提示词。
