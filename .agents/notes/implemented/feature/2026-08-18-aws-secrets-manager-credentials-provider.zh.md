# Agent Note: AWS Secrets Manager 凭据 provider

Status: implemented

[English](2026-08-18-aws-secrets-manager-credentials-provider.md) | 中文

## Problem

在 AWS 容器中运行的 DSH agent 需要从 AWS Secrets Manager 解析模型 API key，而不是从本地凭据文件读取。现有的 `dsh-credentials-local` provider 读取 `$DSH_HOME/.credentials.yaml`，这对本地开发是正确的，但对通过 AWS IAM 和 Secrets Manager 配置 secret 的容器是错误的。模型侧（`llm-pi-ai`、路由、fallback）不变；只有 key 来源改变。

## Decision

### 新包：`dsh-credentials-aws-secrets-manager`

在 `packages/credentials/` 下新建一个同级包，基于 AWS Secrets Manager 实现 `CredentialProvider` seam。它是一个新目录，与上游同步无冲突面，遵循核心功能合并到 master、部署分支只携带 wiring 的运营模式。

### 引用到 secret 的映射

每个 `CredentialRef` 映射到名为 `<secretPrefix><ref>` 的 secret。payload 可以是纯字符串（`secretFormat: plain`）或 JSON 对象（`secretFormat: json`，默认值）。对于 JSON payload，引用名本身就是默认字段，因此 `{"DEEPSEEK_API_KEY":"sk-…"}` 无需额外配置即可解析 `DEEPSEEK_API_KEY`；当部署使用不同的键时，`jsonField` 覆盖该字段。

### AWS 原生凭据解析

provider 使用 `@aws-sdk/client-secrets-manager`，并通过标准凭据链解析 AWS 凭据：环境变量、`AWS_PROFILE`、ECS 任务角色和 web identity token。在 AWS 内部不需要存储密钥。`region` 和 `profile` 是可选 Config 字段；省略时交给 SDK 默认链。

### 写入

`set` 在 secret 不存在时创建它（`CreateSecret`），否则更新它（`PutSecretValue`）。`unset` 强制删除 secret。两者在提交后都会发出 `credentials/updated`。

## Alternatives considered

**用 AWS 后端扩展 `dsh-credentials-local`。** 本地 provider 的文件分层、监视器生命周期和权限模型是本地开发关注点。把 AWS API 调用混入该包会把两个不相关的存储后端耦合在一起，使两者都复杂化。同级包让每个 provider 保持专注。

**使用容器编排器注入的环境变量。** ECS/Fargate 可以把 secret 注入为环境变量，但这会把它们暴露给容器中的每个进程，并且轮换对运行中的进程不可见。Secrets Manager 把值挡在环境之外，并让应用每次操作重新解析。

**在内存中缓存解析后的 secret。** 缓存会减少 API 调用，但过期的 secret 会持续到重启。该 seam 的契约是每次操作解析；需要缓存的部署可以在更高层添加。

## Consequences

- 在 ECS/Fargate/AgentBox 中的 DSH agent 可以从 Secrets Manager 解析模型 key，无需任何本地凭据文件。
- 本地开发继续使用 `dsh-credentials-local`；两个 provider 通过同一个 `ctx.credentials` seam 可互换。
- 该包新增一个外部依赖（`@aws-sdk/client-secrets-manager`），不改动现有包。
- 未实现热重载：Secrets Manager 没有文件系统监视器，因此外部轮换在下一次 `resolve` 时生效，但不会发出 `credentials/updated`。

## Testing

- `packages/credentials/dsh-credentials-aws-secrets-manager/tests/aws-secrets-manager.spec.ts` 覆盖纯文本与 JSON 解析、默认与覆盖 JSON 字段、缺失 secret、空字段、无效 JSON、`describe`、`set` 创建/更新，以及 `unset` 删除/忽略缺失。
- 完整的 `packages/credentials/` 套件通过（80 个测试）。
