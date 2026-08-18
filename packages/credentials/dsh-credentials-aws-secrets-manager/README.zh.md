# dsh-credentials-aws-secrets-manager

[English](README.md) | 中文

DeepSeek Harness 的 AWS Secrets Manager [凭据](../credentials/README.md) provider。

每个凭据引用映射到一个名为 `<prefix><ref>` 的 Secrets Manager secret。payload 可以是纯字符串或 JSON 对象；当它是 JSON 时，引用名本身就是默认字段，因此 `{"DEEPSEEK_API_KEY":"sk-…"}` 无需额外配置即可解析 `DEEPSEEK_API_KEY`。

凭据通过标准 AWS 凭据链认证——环境变量、`AWS_PROFILE`、ECS 任务角色和 web identity token——因此在 AWS 中运行的容器不需要存储密钥。`region` 和 `profile` 是默认凭据链的可选覆盖。

## Config

| 字段 | 默认值 | 含义 |
|---|---|---|
| `region` | SDK 默认值 | Secrets Manager 客户端的 AWS region。 |
| `profile` | SDK 默认值 | 凭据链的 AWS profile。 |
| `secretPrefix` | `/dsh/` | 前缀，拼接到每个引用前以形成 secret 名称。 |
| `secretFormat` | `json` | Payload 形状：`plain` 为原始字符串，`json` 为 JSON 对象。 |
| `jsonField` | 引用名 | 当 `secretFormat` 为 `json` 时携带值的 JSON 属性。 |

## Secret 形状

纯文本 secret 直接保存值：

```text
sk-…
```

JSON secret 将值保存在引用名（或 `jsonField`）下：

```json
{"DEEPSEEK_API_KEY": "sk-…"}
```

缺失的 secret 解析为未配置。空字符串、缺失的 JSON 字段或非字符串 JSON 值均视为缺失。`json` 格式下的无效 JSON 会响亮地失败。

## 写入

`set` 在 secret 不存在时创建它（`CreateSecret`），否则更新它（`PutSecretValue`）。`unset` 强制删除 secret。两者在提交后都会发出 `credentials/updated`。

## Model Experience

通过消费它的 LLM 适配器间接产生：存储的值授权其 provider 请求，而适配器拥有所有模型可见的表面。

#### KV Cache 影响

无直接失效；凭据从不进入请求前缀。

## Known Limitations and Deferred Work

- **无热重载** —— Secrets Manager 不发出文件系统事件；轮换后的 secret 会在下一次解析时生效，但外部轮换不会触发 `credentials/updated` 广播。本地 provider 的文件监视器仍是开发环境的热重载路径。
- **无缓存** —— 每次 `resolve` 都会执行一次 `GetSecretValue` 调用。如果每秒解析大量引用，应在 Secrets Manager 前加一层本地缓存。
- **不读取二进制 secret** —— 忽略 `SecretBinary` payload；provider 只读取 `SecretString`。
