# Agent Note: 智能体控制 P0 —— 带权威投影的类型化调查状态

Status: implemented

[English](2026-08-18-dsh-agentic-control-p0.md) | 中文

## 问题

FLINTER 的视频审查工作会运行候选调查，其物理证据状态必须在压缩、重放和恢复之后仍然存活，同时作为权威上下文对模型可见。在此次改动之前，harness 没有对应的类型化接缝：临时实现会把可变状态放进插件局部变量，对重放不可见、恢复时丢失，并且无法与模型注入的文本区分。模型还需要有界的宏动作——评估、完成、未知即停——这些动作只能通过经过验证、记录在案的转换来改变状态，绝不能只靠提示词文本。

## 决策

`packages/agentic-control/` 下的两个包实现该接缝。

### `@deepseek-ai/dsh-agentic-control` —— 服务

`InvestigationService`(`packages/agentic-control/agentic-control/src/index.ts`)为每个 agent 持有一个调查,从持久的 `investigation/change` 会话事件折叠而来(`INVESTIGATION_CHANGE_VERSION = 1`)。`src/types.ts` 存放纯领域类型:`InvestigationState` 包含候选、证据要求及其派生状态、物理评估字段、谱系、预算和阶段(`active`/`finished`/`stopped-unknown`)。`src/fold.ts` 是严格解码器加转换校验折叠:`decodeInvestigationChange` 拒绝畸形载荷,折叠拒绝乱序的修订号和非法阶段转换,而不是修复它们。

变更经由 `commit()` 提交,它会在追加之前对拟议变更做干跑折叠,因此畸形的提供者输出永远不会进入日志。抛出异常的物理评估提供者仍会先提交一条消耗预算的 `assess-failed` 变更,再让错误传播;结果未通过校验的提供者抛出 `INVESTIGATION_INVALID_RESULT`,不消耗任何预算。评估提供者通过 `registerProvider()` 注册(返回处置器),并在首次评估时按经过校验的 `provider` 配置字段惰性解析;`maxAttempts` 默认为 3。包内不变量伴侣会独立重放每个会话的折叠,并与服务的实时状态对比。

### `@deepseek-ai/dsh-tool-agentic-control` —— 模型界面

该函数插件在服务之上贡献三个宏动作工具和一个系统提示词节(`tool:agentic-control`,顺序 115)。`run_physical_assessment` 按配置的提供者执行一次评估。`finish_investigation` 和 `stop_unknown` 提交终态转换,通过 `exec.concludeTurn()` 结束当前回合,并返回字面量的结果阶段。一个终态的 `ctx.tools.guard` 会在调查阶段不是 `active` 时拒绝全部三个工具,因此已结束的调查无法被过时的模型输出重新进入。

每次调用都要求 `exec.agent` 存在,否则抛出 `INVESTIGATION_TOOL_NO_AGENT`。权威投影是一个前置的 `agent/pre-step` 监听器,它渲染当前状态并作为持久的、带来源标注的 `user/message`(`source.plugin === 'tool-agentic-control'`)追加,按会话用 `WeakMap` 持有的修订计数器去重,因此任何步骤都不会重复投影未变化的修订。由于投影是记录在案的消息,它满足"模型可见 ⟺ 已记录"不变量,并且可以精确重放。

## 测试

单元覆盖(95 个测试,两个包的 `src` 均为 100%)固定了解码器与折叠严格性表、包括失败/乱码/部分提供者在内的全部服务转换、预算记账、惰性提供者解析、处置器行为、不变量的独立折叠、非 active 阶段的守卫拒绝、投影渲染与去重,以及终态工具的回合结束行为。P0.6 验收测试(`examples/aws-headless/tests/agentic-trajectory.e2e.ts`)在进程内启动真实组合的 aws-headless 配置,以 llm-replay 瀑布充当模型:一次特权 `start`、一次重放的 `run_physical_assessment` 和一次 `finish_investigation` 恰好产生 `start → assess → finish` 变更;严格折叠与服务实时视图相等;两条投影消息进入持久历史;Bedrock、Secrets Manager 和 Orca 能力在该接缝旁完整组合。该配置中禁用了会话标题提供者,因为它自己的模型调用会消耗一条脚本化重放条目。

## 考虑过的替代方案

- **插件局部可变状态 + 仅提示词可见** —— 否决,因为它对重放不可见、恢复时丢失,且违反"模型可见 ⟺ 已记录"。
- **允许模型启动调查** —— 否决;`start` 是特权宿主通道,候选选择不能由模型输出制造。
- **容错修复式折叠** —— 否决,因为被静默纠正的转换会让畸形提供者输出改写持久历史。
- **失败评估不消耗预算地重试** —— 对提供者抛错予以否决;一次已尝试的评估就是真实的一次尝试,而无效结果在任何预算花费之前就被拒绝。

## 影响

- 调查状态持久、可重放,并在模型上下文中具有权威性;压缩与恢复都能精确重建它。
- 模型可以评估、完成或未知即停,但不能启动调查、直接修改字段,或在非 active 阶段行动。
- 提供者选择与尝试上限是经过校验的配置,可按部署从 cordis.yml 修改。
- 物理评估提供者通过注册接入,无需改动服务或工具。

## 已知限制与延后工作

- P0 只附带 `stub` 来源的提供者;真实的物理评估提供者是独立的包。
- 经过免密钥 ACP/headless 重放装置的正式 stream-json 快照夹具被延后;轨迹 e2e 已经通过真实组合的配置覆盖了装配后的转录。
- 每个 agent 一个调查;多候选扇出属于后续阶段。
