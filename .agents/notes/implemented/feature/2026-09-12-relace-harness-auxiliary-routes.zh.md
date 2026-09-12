# Agent Note: DSH harness 中的 Relace 辅助搜索与候选 Apply

Status: implemented

[English](2026-09-12-relace-harness-auxiliary-routes.md) | 中文

## Problem

DSH 需要 Relace Agent Search 来快速理解代码仓库，也需要 Relace Apply-3 来执行有界代码变换。Search 是只读的多轮工具协议，而 Apply-3 是独立的一次性候选结果请求。把任一者当作普通 runner 提供方会混淆 host 的文件系统权威、模型工具执行、候选写入与 DSH runner 的默认模型策略。

## Decision

`dsh-llm-pi-ai` 负责 harness 适配器。它导出 `relace/relace-search` 与 `relace/relace-apply-3` 的 OpenRouter profile，默认共享 `OPENROUTER_API_KEY` 引用，并提供显式工厂以使用分别保管的 Search 与 Apply 引用。profile 只包含引用，绝不包含密钥值。

Search 使用 Relace 要求的五个严格工具：`view_file`、`view_directory`、`grep_search`、`bash` 与 `report_back`。请求构造器提供文档规定的系统提示词和用户提示词形状，`createRelaceSearchToolBridge()` 在分派到 host 回调前校验参数。workspace 路径解析、输出上限、只读命令 allowlist、取消、并行执行与五轮上限均由 host 负责。bridge 不提供写入回调。

Apply-3 使用独立的一次性请求，不声明 tools 或 response-format hint。formatter 生成必需的 `<code>` 与 `<update>` 标签，以及可选的单行 `<instruction>`，拒绝有歧义的闭合标签，并在文档规定的提供方输入容量以下执行字符上限。parser 返回候选合并代码与用量，不执行写入。调用方通过正常 DSH 写入路径审查候选结果、diff 与测试。

`.dsh/skills/relace-harness/SKILL.md` 项目 skill 将已配置的 Kimi 编程／推理路由与两个辅助路由组合起来。只有当前 profile 暴露该模型时，它才可以选择已建立的 `ark-agent-plan` / `kimi-k3` 路由；它不会臆造 Relace Kimi 提供方或凭据。AWS worker overlay 为共享或分别保管的 OpenRouter Relace 凭据暴露可选 JSON 引用，并保持 `allowWrites: false`。

## Alternatives considered

**修改 DSH runner 或其默认路由。** 拒绝，因为这些是 harness 级别的辅助能力，不能改变 runner 的正常模型选择或本地网关行为。

**把 Apply-3 放进 Search 工具循环。** 拒绝，因为 Search 是只读探索，而 Apply-3 产生代码候选；合并两者会模糊工具权限，并让未经审查的写入路径变得容易发生。

**把 Jacq 的加密桌面会话 token 当作 API key 重用。** 拒绝，因为该桌面 token 不是文档规定的 Relace 或 OpenRouter API key，不能凭推断复制到 AWS。

## Consequences

不改变 canonical DSH runner 分支，harness 仍可组合 Kimi、Search 与 Apply-3。部署可以使用一个 OpenRouter key，也可以分别轮换两条路由引用。缺失的凭据引用只会在选择可选路由时失败；无密钥单元测试无需凭据。host 仍必须提供实际回调实现并执行轮次上限，因此适配器与测试不声称已经完成真实提供方 E2E。

## Testing

Relace 与转换测试套件共 81 个测试通过，`llm-pi-ai` TypeScript 构建通过，AWS worker profile 测试也通过并包含三个可选 OpenRouter secret 映射。没有凭据被打印或存入源代码、项目 skill 或测试前置数据。
