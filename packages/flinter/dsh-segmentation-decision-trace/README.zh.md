---
description: "把生产者归一化的分割决策记录投影到有界 FLINTER 决策轨迹的生产者适配器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-segmentation-decision-trace

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-segmentation-decision-trace` 按一个既有分割工具的准确名称在 `ctx.flinterDecisionTrace` 上挂载一个 `DecisionTraceAdapter`。规范化的请求/结果记录由生产者所有；此软件包按有界允许列表对记录做失败即拒绝的验证，并投影到 `SelectionProjection`/`ResultProjection` 捕获约定。它从不注册工具、不改变工具行为或策略、不加入模型可见内容、不调用提供方、不建立索引，也不写推理库。

此软件包仅为源/fixture（测试前置数据）适配器。不声明任何真实 TowerH 或分割生产者、提供方执行、重启/回放运行、一万次 episode（决策片段）运行、开销测量、独立验证器或 Gate 1 回执/PASS。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 `@deepseek-ai/dsh-decision-trace` 之后挂载函数插件。其配置带有 `source` 解析函数，无法用 YAML 表达；生产者以编程方式挂载它，给出准确的工具名称和自己的规范化解析器。

### 何时选择

当分割生产者能把自己的决策事实陈述为不透明有界引用和封闭状态，并希望这些事实被捕获、同时不把原始参数、提示词、提供方载荷或错误文本写进会话日志时，选择本包。工具尚不存在时不适用——适配器只认领一个既有的准确工具名称；生产者无法规范化事实时也不适用，因为无效记录会失败即拒绝，而不会被部分捕获。

### 设置

```ts
import { Context } from '@deepseek-ai/cordis'
import * as segmentationTrace from '@deepseek-ai/dsh-segmentation-decision-trace'
import type { SegmentationDecisionSource } from '@deepseek-ai/dsh-segmentation-decision-trace'

declare const source: SegmentationDecisionSource

async function mount(ctx: Context): Promise<void> {
  await ctx.plugin(segmentationTrace, {
    toolName: 'segment.select',
    source,
  })
}
```

`SegmentationDecisionSource` 的解析器为每次执行返回生产者所有的 `SegmentationDecisionRequest` 与 `SegmentationDecisionResult` 记录。必需的请求事实是非空的 `allowedActions`、属于它的 `chosenAction`，以及 `sourceRef`/`modelRef`/`policyRevisionRef`。必需的结果事实是显式的 `outcome` 与 `disposition`——包括 `'unknown'`——使缺失的事实不能藏在默认值后面。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 失败即拒绝的允许列表

`createSegmentationDecisionAdapter(source)` 包装生产者解析器，并在投影前验证其返回的每条记录。只读取允许列表中的字段；未知记录字段从不复制，因此生产者本地或敏感值不可能逃逸。必需事实缺失或格式错误会抛出异常，捕获服务只记录一个固定诊断码——`selection:projection-failed` 或 `result:projection-failed`——且不改变工具结果。

### 有界引用与默认值

每个引用是一个最多 160 字符的有界字符串，字母数字开头后只能出现 `[A-Za-z0-9_.:/-]`——网址、空格和自由文本都无法解析——每个列表最多 32 个不重复引用。`budgetBefore` 与 `usage` 接受非负安全整数，或用 `null` 表示未测量的成本。省略的事实默认为空引用列表、`null` 测量值、`'unknown'` 血缘和 `false` 的记录/索引就绪状态，绝不从工具结果推断。全部十五种 `DecisionStatus` 结果——成功、拒绝、弃权、证据不可用、响应格式错误、提供方错误、超时、耗尽、部分保留、导出冲突、回放、重启、取消、未完成和未知——以及全部六种处置都原样保留。

### 生命周期与释放

`apply` 通过 `ctx.effect` 注册适配器，因此注册释放函数由插件 fiber 持有：插件 fiber 被 dispose（资源释放）或热重载时只移除此注册，且释放函数只在仍持有该名称时才删除它。重复的工具名称会以捕获服务的重复注册错误使挂载失败，既不泄漏注册也不泄漏 effect。此软件包保持准确的工具名称，自身不注册任何工具。

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 失败即拒绝的投影验证器、`createSegmentationDecisionAdapter`、插件配置与 `apply`。 |
| [`src/types.ts`](src/types.ts) | 生产者所有的规范化请求、结果与源约定。 |
| [`src/invariant.ts`](src/invariant.ts) | 面向 DSH 测试宿主的包自有不变量伴随件。 |
| [`tests/segmentation-decision-trace.spec.ts`](tests/segmentation-decision-trace.spec.ts) | 有界投影、失败遏制、重复注册与 HMR 安全测试。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [DSH decision trace](../dsh-decision-trace/README.zh.md)——此适配器注册进的捕获服务、投影约定、诊断与回放 fold。
- [DSH tools](../../core/tools/README.zh.md)——捕获观察器挂钩的工具分发事件。
- [DSH session](../../core/session/README.zh.md)——存储决策事件的持久会话日志。
- [扩展子系统](../../../docs/subsystems/extensions.zh.md)——生成的 `ctx.flinterDecisionTrace` 服务 API。
- [FLINTER 组映射](../README.zh.md)——同组 FLINTER 软件包及组的 DSH 边界。

-----

<a id="model-experience"></a>
## 模型体验

### 分割决策捕获

#### 模型看到什么

此软件包不会向模型请求加入任何内容。适配器通过捕获服务发出只写日志的 `flinter/decision-selection` 与 `flinter/decision-result` 事件，不改变工具 schema、提示词或结果内容。

#### Token 影响

此软件包不发起模型调用，也不增加模型 token。每个引用列表最多包含 32 项，每个引用最多 160 个字符。

#### KV Cache 影响

此软件包不改变模型可见前缀，因此不会直接影响 KV cache。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **证据仅限 fixture 范围**——确定性 fixture 只证明软件包行为。不声明任何真实 TowerH 或分割生产者、提供方执行、持久化重启/回放、一万次 episode 运行、开销测量、独立验证器或 Gate 1 回执/PASS；每一项仍需单独验证。
- **事实由生产者所有**——此软件包验证并投影生产者提供的规范化记录；它不从原始执行推导分割事实，因此缺少生产者解析器就意味着没有捕获。
- **没有索引或推理库写入器**——记录和索引就绪状态由生产者提供；此软件包不写证据索引或推理库。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
