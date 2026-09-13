---
description: "DSH 凭据 seam 的只读 AWS Secrets Manager provider。"
kind: "package-reference"
---

# @deepseek-ai/dsh-credentials-aws

[English](README.md) | 中文

这个可选 provider 从 AWS Secrets Manager 读取 JSON `SecretString`，并通过
现有的 `ctx.credentials` contract 提供凭据。Secret 将
`OPENROUTER_API_KEY` 这样的 credential reference 映射到非空字符串值。

继承的进程环境优先，并且保持只读。AWS 值只在内存中保存，按有限间隔刷新；
`describe()` 不返回值，诊断不会打印值，也不会写入磁盘。运行时写入和 credential
record 明确不支持。EC2 使用 instance role/default AWS credential chain；本包不保存
access key。

```yaml
secretId: flinter/dsh-runtime
region: us-east-2
refreshMs: 60000
```

本地 `.credentials.yaml` 开发继续使用现有 local provider。一个 composition 同时只应
挂载一个 `ctx.credentials` provider。镜像或轮换凭据必须是明确的 operator workflow，
不能成为运行时的自动副作用。

## Model Experience

### Credential resolution

#### What the model sees

模型只在请求时获得解析后的凭据。配置和状态界面只能看到 reference 与脱敏后的存在性，
不能看到凭据值。

##### Runtime contract

```markdown
credential reference -> resolve at request time -> provider request
```

#### Token effect

credential reference 和状态元数据不会增加模型 prompt token。本 provider 不会把凭据值插入
prompt。

##### Prompt effect

```markdown
no credential value is added to the model context
```

#### KV Cache effect

凭据刷新发生在模型 prompt 之外，不会改变 KV cache 前缀稳定性。

##### Stable prefix

```markdown
provider configuration remains outside model messages
```
