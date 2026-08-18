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

三个互斥工具，通用、仅参数的展示方式，以及一段策略指引（`tool:agentic-control`，order 115）。

#### KV 缓存影响

步骤前投影仅在状态修订号变化时追加新快照消息，状态不变则不会使请求前缀失效。

## 已知限制与暂缓工作

- **无能力路由器或台账** —— P0 的模型界面就是这三个宏操作；经验与自我改进循环明确不在范围内。
