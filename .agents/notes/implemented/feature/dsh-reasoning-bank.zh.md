# DSH 推理证据库

[English](dsh-reasoning-bank.md) | 中文

新增 `@deepseek-ai/dsh-reasoning-bank`，为已接受的轨迹元数据和证据 ID 提供有界确定性 FIFO 服务，并通过 Cordis `ctx.provide` 提供可选接缝、由 `ctx.get` 读取。它拒绝未接受结果和格式错误的证据 ID，不保存负载、秘密、思维链或媒体。测试覆盖配置、边界、去重、淘汰、搜索、服务释放以及插件启停。该服务是未来自我改进消费者的可选宿主接缝，尚未接入默认组合或持久化后端。
