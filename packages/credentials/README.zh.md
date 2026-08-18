# credentials/：凭据引用

[English](README.md) | 中文

凭据能力家族将引用解析与提供方分离：

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`credentials/`](credentials/README.md) | 凭据引用 seam | `ctx.credentials` |
| [`credentials-local/`](credentials-local/README.md) | 环境与本地文件提供方 | 注册 `ctx.credentials` |
| [`dsh-credentials-aws-secrets-manager/`](dsh-credentials-aws-secrets-manager/README.md) | AWS Secrets Manager 提供方 | 注册 `ctx.credentials` |

配置携带引用而非机密值。消费方在其操作边界解析这些引用；变更、优先级与存储语义由子级 README 负责。

子系统参考——`CredentialRef`、按操作解析、对 UI 安全的 `CredentialInfo`、提供方层——见 [docs/subsystems/credentials.md](../../docs/subsystems/credentials.md)。

## 如何添加密钥

### 本地开发

使用 `dsh-credentials-local`。密钥保存在 `~/.dsh/.credentials.yaml` 中，为 YAML 映射：

```yaml
DEEPSEEK_API_KEY: sk-…
OPENCODE_GO_API_KEY: sk-…
KIMI_CODING_API_KEY: sk-…
```

也可以通过 DSH Models 界面写入；文件会以 `0600` 权限创建。

### AWS Bedrock

Bedrock **不**使用 API key。它通过 AWS 凭据链（IAM 任务角色、实例 profile、`AWS_PROFILE` 等）认证。没有需要添加的 "Bedrock key"。

要启用 Bedrock，在 `settings.yaml` 中声明该 provider：

```yaml
llm-pi-ai:
  providers:
    amazon-bedrock:
      region: us-west-2   # optional
      profile: production # optional
```

没有单独的启用/禁用开关。如果 `amazon-bedrock` 出现在 `providers` 中，DSH 就会注册它；删除该条目即禁用。将请求路由到 `provider: amazon-bedrock` 即可使用。

### AWS 中的第三方 API key

将它们存入 AWS Secrets Manager 并挂载 AWS 凭据 provider：

```yaml
# cordis.yml or settings.yaml
credentials:
  provider: aws-secrets-manager
  config:
    secretPrefix: /dsh/
    secretFormat: json
```

为每个 key 创建一个 secret：

```bash
aws secretsmanager create-secret \
  --name /dsh/THIRD_PARTY_API_KEY \
  --secret-string '{"THIRD_PARTY_API_KEY":"sk-…"}'
```

DSH 在请求时从 Secrets Manager 解析 `THIRD_PARTY_API_KEY`。容器中不需要本地凭据文件。
