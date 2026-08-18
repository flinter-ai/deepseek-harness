# dsh-agentic-control

[English](README.md) | 中文

DeepSeek Harness 的事件溯源调查控制能力：每个会话一份类型化的 `InvestigationState`，仅通过全量快照 `investigation/change` 会话事件提交。

状态跟踪候选对象（`id`、`actionFamily`、`window`）、带派生状态的证据需求、四个独立评估的物理维度（手部观察有效性、轨迹质量、HOI 支持度、物体轨迹质量）、由提供方给出的谱系判定、带来源标记的尝试日志，以及尝试预算。

## 权限边界

调查由 harness 通过特权通道 `ctx.investigations.start` 创建，模型永远不能创建。谱系只能由已注册的 `PhysicalAssessmentProvider` 的类型化结果来更改；任何工具参数或模型输出都不能挂载或驳回谱系。每次评估尝试——无论失败与否——都消耗一格预算。

## 提供方

`runPhysicalAssessment` 在首次评估时惰性解析配置的提供方，因此提供方插件可以晚于本服务加载。P0 仅内置 `stub` 提供方：它解析所有维度并挂载谱系。真实的 Tower 适配器通过 `ctx.investigations.registerProvider(provider)` 注册，该方法返回销毁器。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxAttempts` | `3` | 未自带上限的调查的默认尝试上限。 |
| `provider` | `stub` | 已注册物理评估提供方的 id。 |

## 重放

`decodeInvestigationChange` 对单条持久化变更做失败即响的校验；`foldInvestigations` 将会话日志重放为当前状态。重放强制：每会话仅一份调查、修订号逐次加一、仅评估操作可追加尝试、终止阶段后不可再变更。包不变量伴生插件（`/invariant`）对已加载和实时日志执行同样的检查。

## 模型体验

间接通过 `dsh-tool-agentic-control`：本服务拥有状态与权限；工具包拥有所有模型可见界面。

#### KV 缓存影响

无直接失效；本服务不写入请求前缀。

## 已知限制与暂缓工作

- **仅 stub 提供方** —— 尚无真实 Tower 适配器；`stub` 无条件解析所有维度。
- **每会话仅一份调查** —— 第二次 start 会被拒绝；多候选会话暂缓。
- **派生证据状态是启发式** —— 覆盖率仅由四个物理维度计算，而非逐条需求核验。
