# DSH Web EC2 部署

[English](README.md) | 中文

本目录负责现有 EC2 上 DSH Web systemd 服务的可重复部署路径。它通过 AWS
Systems Manager（SSM）部署固定的 Git commit，重新构建 AWS 凭据 provider 和
FLINTER worker profile，重新执行受支持的 profile 安装命令，并在不把模型 API
密钥放进 systemd 或进程环境的前提下验证需要认证的 Web 端点。

## 自动运行的内容

`.github/workflows/deploy-dsh-ec2.yml` 会在 `master` 分支的 push 修改 DSH
runtime、profile、provider 或部署文件时运行，也可以手动输入明确的 Git ref。
工作流会：

1. checkout 一个精确 commit 并记录完整 SHA；
2. 通过 GitHub OIDC 和范围受限的部署 role 认证 AWS；
3. 对已停止的 EC2 或 SSM 离线目标直接拒绝；
4. 通过 `AWS-RunShellScript` 将 `deploy.sh` 发送到目标；
5. 验证 checkout origin、拒绝 tracked drift 或与目标 commit 冲突的 untracked
   文件、备份 profile 文件、使用冻结 lockfile 安装依赖、构建 provider 和
   profile，并重新执行 profile bundle 安装；
6. 通过 EC2 instance role 解析 Ark 引用，重启 `dsh.service`，检查 `3080` 端口，
   期望未认证根路径返回 HTTP `401`，并检查凭据形状的环境变量不存在。

工作流串行化，因此两个部署不会同时修改同一份 profile。远端脚本在切换
commit 后的步骤失败时回滚 Git revision 和 profile 文件。备份保留在主机的
`/var/lib/dsh-phase2/deploy-backups` 下。

## 一次性 GitHub 和 AWS 配置

创建受保护的 GitHub Actions environment `dsh-ec2-production`，并设置以下非
secret 环境变量：

| 变量 | 值 |
|---|---|
| `DSH_AWS_REGION` | 当前 DSH Web 主机使用 `us-east-2`。 |
| `DSH_EC2_INSTANCE_ID` | 目标 DSH Web EC2 instance ID。 |
| `DSH_DEPLOY_ROLE_ARN` | 信任本仓库 GitHub OIDC subject 的 IAM role ARN。 |

GitHub role 只需要区域内 EC2 状态读取、SSM 目标就绪检查、针对目标 instance
的 `ssm:SendCommand` 和 `ssm:GetCommandInvocation`。它不需要
`secretsmanager:GetSecretValue`。EC2 instance role 仍然是 DSH secret 映射的
权限主体，并且应只保留 profile 实际需要的读取权限。

本仓库当前不会自动创建 GitHub OIDC provider 或 IAM role。这是账户级信任
决策，必须由现有 AWS 基础设施负责人一次性配置。role 的 trust policy 必须
使用规范 `flinter-ai/deepseek-harness` 仓库在 `dsh-ec2-production` environment
中的 immutable OIDC subject；environment 的 deployment branch policy 另外只允许
`master`。在三项 environment 变量和该信任关系存在之前，工作流会在发送命令前
fail closed。

## EC2 前置条件

目标主机必须已经具备：

- `/opt/dsh-phase2` 下的 live checkout，且 `origin` 为规范的
  `https://github.com/flinter-ai/deepseek-harness.git` source；
- 没有 tracked drift 的 checkout、`dsh.service` unit，以及监听 `3080` 的 active
  服务；
- 报告为 `Online` 的 SSM agent，以及能够读取配置的 Secrets Manager 引用的
  instance profile；
- `/root/.dsh-phase2` 下的持久 DSH home，包括 `tod` profile；
- 满足仓库 lockfile 和 engine policy 的 Node 与 pnpm 版本。

工作流不会启动或停止 instance，不会强制 reset tracked checkout drift，不会
轮换凭据，也不会开放 public port。与目标 commit 不冲突的 untracked operational
文件会保留。停止状态必须由 operator 明确处理，然后重新运行工作流。浏览器
session 授权记录仍然保存在进程内，服务重启后会重新创建；模型 API 密钥继续在
请求时从 Secrets Manager 解析。

## 手动操作和回滚

如需受控的主机端 rehearsal，可以以 root 身份设置
`DSH_DEPLOY_SHA`、`DSH_DEPLOY_REMOTE` 和 `DSH_DEPLOY_AWS_REGION` 后运行同一个
`deploy.sh`。优先使用工作流，因为它提供 commit 和 AWS 身份，不需要长期 GitHub
访问密钥。

如果切换 checkout 后部署失败，脚本会恢复此前的 commit 和 profile 文件并重启
服务。请在主机上检查带时间戳的备份目录和 `journalctl -u dsh.service`；不要把
`.credentials.yaml`、AWS secret 值、cookies、bearer tokens 或完整进程环境输出到
Actions 日志。

## 证据边界

本地 build 或工作流步骤变绿，只证明对应的 source、SSM 和主机检查。除非工作流
确实到达目标并报告脱敏的
`dsh-ec2-deploy: deployment=success` 行，否则不证明 phone/desktop tunnel、
GitHub remote 编辑或新的 live deployment 已经完成。
