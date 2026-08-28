# dsh-tool-agentic-control

[English](README.md) | 中文

面向模型的有界宏操作，基于 [dsh-agentic-control](../agentic-control/README.md) 调查域：`run_physical_assessment`、`finish_investigation`、`stop_unknown`，以及在每个 agent 步骤前注入的权威状态投影。

## 投影

一个前置的 `agent/pre-step` 监听器在调查的持久化修订号变化时，追加一条带来源标记（`plugin: tool-agentic-control`、`form: snapshot`）的当前状态渲染。agent 循环把进入的消息记录为普通的持久化 `user/message` 事件，因此模型看到的一切都能从会话日志重建。

## 工具

| 工具 | 效果 | 是否终止 |
|---|---|---|
| `run_physical_assessment` | 运行一次提供方介导的评估；即使失败也消耗一格预算。 | 否 |
| `finish_investigation` | 结束一份证据已满足的进行中调查。 | 是（结束当前回合） |
| `stop_unknown` | 将进行中的调查标记为无法解决，并持久化原因。 | 是（结束当前回合） |

没有任何工具参数能触碰谱系或判定：结果由提供方经由服务产生。一旦调查离开 `active` 阶段，终止守卫会拒绝全部三个工具。

## 模型体验

### 状态投影

#### What the model sees

当由 harness 发起的调查产生新的持久化修订号时，插件会在下一次模型步骤前追加一条带来源标记的状态快照。快照描述候选、证据状态、分别评估的物理维度、提供方编写的谱系、阶段和尝试预算；模型不能发起调查，也不能编写谱系。

#### Token effect

每个到达前置步骤的持久化修订号都会增加一条紧凑的 user 角色状态快照；修订号未变化时不会增加投影 token。

#### KV Cache effect

投影会追加在现有请求前缀之后。状态变化只增加后缀内容，不会重写之前的提示 token。

### 工具 schema

#### What the model sees

可见时，三个互斥 schema——`run_physical_assessment`、`finish_investigation` 和 `stop_unknown`——以通用、仅参数的形式提供有界宏操作；生成的[工具目录章节](../../../docs/tool-catalog.md#deepseek-aidsh-tool-agentic-control)记录确切 schema。策略指引（`tool:agentic-control`，order 115）说明使用时机。

#### Token effect

插件激活期间，可见 schema 和指引会增加固定的请求前缀成本；调用参数与结果各自增加历史 token。

#### KV Cache effect

只要插件注册和工具可见性不变，schema 与指引保持前缀稳定。注册或作用域可见性变化会从第一个变化的 schema 或指引 token 起使缓存复用失效。

### 工具结果

#### What the model sees

`run_physical_assessment` 返回提供方编写的物理维度、谱系、摘要、证据状态、修订号和预算计数。终态工具返回阶段、修订号和证据状态；失败会保持显式状态，不会被伪造为判定。

#### Token effect

工具参数与紧凑 JSON 结果会保留在会话历史中直到压缩；状态投影是上面所述的、单独由修订号触发的上下文。

#### KV Cache effect

调用和结果会追加在可复用请求前缀之后。除非独立的状态或工具可见性变化改变该前缀，否则不会使之前的缓存条目失效。

## 已知限制与暂缓工作

- **无能力路由器或台账** —— P0 的模型界面就是这三个宏操作；经验与自我改进循环明确不在范围内。
