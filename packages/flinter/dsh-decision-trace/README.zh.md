---
description: "为选择性接入的 FLINTER DSH 生产者记录有界且包含失败的决策事实。"
kind: "package-reference"
---

# @deepseek-ai/dsh-decision-trace

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-decision-trace` 允许生产者按准确的 DSH 工具名称注册适配器，并把执行前选择与执行结果成对投影到持久会话日志。记录内容只包括明确引用、计数、封闭状态和就绪标志。工具参数、提示词、思维链、结果内容、提供方响应、凭证、媒体字节、网址和原始错误文本均不会写入。

此软件包只负责捕获和确定性回放。它不选择动作、不改变策略、不执行提供方、不建立索引、不连接推理库，也不代表任何交付门已通过。

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

在 `@deepseek-ai/dsh-tools` 之后挂载函数插件，然后由生产者插件调用 `ctx.flinterDecisionTrace.register(toolName, adapter)` 注册适配器。生产者应把返回的释放函数纳入自己的 Cordis effect，以便热重载时移除注册。

### 何时选择

当 FLINTER 生产者需要为自己拥有的工具记录持久且包含失败的决策事实，同时又不能把提示词、参数、内容或错误文本写进会话日志时，选择本包。当捕获必须改变工具结果时不适用——观察器只写日志，从不改变结果——以及当还没有生产者适配器时也不适用，因为在生产者注册准确的工具名称之前本包不记录任何内容。

### 设置

挂载插件，无需配置：

```yaml
- name: '@deepseek-ai/dsh-decision-trace'
```

适配器负责把生产者数据映射为不透明且有界的引用。捕获失败只会向 `ctx.flinterDecisionTrace.diagnostics` 追加一个固定诊断码——`selection:projection-failed` 或 `result:projection-failed`——不会改变工具结果。只有选择或只有结果的记录在回放时均标记为 `incomplete`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 回放行为

`foldDecisionEpisodes(events)` 会验证持久投影，按包含会话身份的决策 ID 配对两个阶段，去除内容完全相同的重复阶段，并拒绝同一决策 ID 下内容或调用／工具身份发生变化的记录。它保留成功、拒绝、弃权、证据不可用、响应格式错误、提供方错误、超时、耗尽、部分保留、导出冲突、回放、重启、取消、未完成和未知结果。

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 捕获服务、有界验证器、`tools/pre-execute` 与 `tools/result` 观察器以及 `foldDecisionEpisodes`。 |
| [`src/types.ts`](src/types.ts) | 决策身份、状态、处置、投影、事件、episode（决策片段）与适配器合约。 |
| [`src/invariant.ts`](src/invariant.ts) | DSH test host 使用的包级 invariant companion。 |
| [`tests/decision-trace.spec.ts`](tests/decision-trace.spec.ts) | 有界捕获、失败、回放与 HMR 安全测试。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [DSH tools](../../core/tools/README.zh.md)——捕获观察器挂钩的工具分发事件。
- [DSH session](../../core/session/README.zh.md)——存储决策事件的持久会话日志。
- [扩展子系统](../../../docs/subsystems/extensions.zh.md)——生成的 `ctx.flinterDecisionTrace` 服务 API。
- [FLINTER 组映射](../README.zh.md)——同组 FLINTER 软件包及组的 DSH 边界。

-----

<a id="model-experience"></a>
## 模型体验

### 决策轨迹捕获

#### 模型看到什么

此软件包不会向模型请求加入任何内容。`flinter/decision-selection` 和 `flinter/decision-result` 都只写日志，不改变工具 schema、提示词或结果内容。

#### Token 影响

此软件包不发起模型调用，也不增加模型 token。每个引用列表最多包含 32 项，每个引用最多 160 个字符。

#### KV Cache 影响

此软件包不改变模型可见前缀，因此不会直接影响 KV cache。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **生产者适配器独立实现**——此软件包只提供注册与捕获机制；分割或搜索生产者必须提供自己的明确投影。
- **没有索引或推理库写入器**——记录和索引就绪状态由生产者提供；此软件包不写证据索引或推理库。
- **不代表交付门通过**——确定性夹具只证明软件包行为；真实提供方、持久化重启、开销、审阅者和交付收据证据仍需分别验证。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
