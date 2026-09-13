---
description: "用于显式 EC2、Sandpack preview 和未来 DSH backend 的 compute capability seam。"
kind: "package-reference"
---

# @deepseek-ai/dsh-compute

[English](README.md) | 中文

此 package 定义可选的 `ctx.compute` seam。host 在其后挂载一个具体 provider，就可以在不修改 Web draft/publish consumer 的情况下切换 EC2 process backend、Sandpack browser preview backend 或未来 backend。此 package 不拥有 workspace storage、authentication、Git、PR 写入，也不包含远程 EC2/Sandpack client。

该 seam 传递 workspace reference、显式 operation、credential reference、有界 lease 和可轮询的 run handle。command request 使用精确 argv，而不是 shell 字符串；preview request 携带 source file 和 entry point。此 API 不包含 raw credential value 字段，output 也必须明确有界。

backend 选择必须显式完成。EC2 host 设置 `DSH_COMPUTE_BACKEND=ec2`，browser preview composition 设置 `DSH_COMPUTE_BACKEND=sandpack`，也可以提供等价的 host config。EC2 与 Sandpack 之间不存在自动 fallback，因此 deployment 不会静默改变 compute 语义。

```yaml
backend: ec2
capabilities:
  operations: [command]
  persistentWorkspace: true
  storage: aws
  network: restricted
  maxConcurrentRuns: 1
```

对于已经拥有 remote client 的 host，可以使用 `DelegatingComputeProvider`。host 提供五个 lifecycle callback，并继续负责 storage durability、credential resolution、admission limit 以及 process 或 browser policy。provider 必须拒绝未声明的 operation，并且必须将 lease 和 run handle 限定在自己的 backend 内。

## Model Experience

### Compute selection

#### What the model sees

面向 model 的 layer 会看到选定 backend 的 capability 和有界 run status，但不会收到 host credential、storage credential，也不会获得隐式的跨 backend fallback。

##### Runtime contract

```markdown
explicit backend -> bounded lease -> exact operation -> pollable run
```

#### Token effect

backend identity 和 run status 只会贡献 host 选择渲染的 metadata。此 seam 不会自动将 source file、log 或 credential 复制到 model context。

##### Prompt effect

```markdown
capabilities and bounded status are opt-in context
```

#### KV Cache effect

除非 consumer 明确将该 metadata 渲染进 prompt，否则 compute capacity 或 backend status 的变化不会改变稳定的 model prefix。

##### Stable prefix

```markdown
compute lifecycle stays outside model messages by default
```
