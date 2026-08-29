# Agent Note：DeepSeek 输出上限可选

状态：已实现

[English](2026-08-29-deepseek-optional-max-tokens.md) | 中文

## 问题

当部署和请求都没有配置输出上限时，DeepSeek chat-completions 适配器会隐式提供 `256000` 的输出 token 上限。OpenAI 兼容部署可能为不同模型提供更低的输出限制，因此透传模型可能在生成前收到一个提供方会拒绝的请求。

## 决策

适配器和 catalog 条目的 `maxTokens` 均为可选。解析过程保留显式的模型级或适配器级上限；两者都未配置时，不生成 `defaultMaxTokens`。因此现有序列化器会省略 `max_tokens`，由选定的提供方应用其模型自身的默认值。显式请求值和 agent 选项仍然优先，并继续序列化为 `max_tokens`。

适配器不会根据 `contextWindow` 推断提供方上限。需要固定输出预算的部署仍可在适配器或模型条目上配置 `maxTokens`。

## 影响

未配置的 DeepSeek 请求使用提供方默认输出预算。已配置的上限保留原有优先级、校验、请求记录和 wire 行为。自动压缩不使用该适配器默认值；其自身的请求选项保持不变。

## 测试

适配器测试验证未配置时省略 wire 字段、解析模型元数据未配置时不包含该字段、保留适配器和模型级配置、显式请求优先，以及拒绝无效上限。完整的 `llm-deepseek` 适配器测试套件通过。
