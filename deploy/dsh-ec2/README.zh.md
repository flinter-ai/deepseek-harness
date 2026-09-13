# DSH Web EC2 部署

[English](README.md) | 中文

本目录负责现有 EC2 上 DSH Web systemd 服务的可重复部署路径。它通过 AWS
Systems Manager（SSM）部署固定的 Git commit，重新构建 DSH Web 所需的 host
和 client library artifacts（包括 Typert 与浏览器 bundles），重新执行受支持的
profile 安装命令，并在不把模型 API 密钥放进 systemd 或进程环境的前提下验证
需要认证的 Web 端点。

## 自动运行的内容

`.github/workflows/deploy-dsh-ec2.yml` 会在 `master` 分支的 push 修改 DSH
runtime、profile、provider 或部署文件时运行，也可以手动输入明确的 Git ref。
工作流会：

1. checkout 一个精确 commit 并记录完整 SHA；
2. 通过 GitHub OIDC 和范围受限的部署 role 认证 AWS；
3. 对已停止的 EC2 或 SSM 离线目标直接拒绝；
4. 通过 `AWS-RunShellScript` 将 `deploy.sh` 发送到目标；
5. 验证 checkout origin、拒绝 tracked drift 或与目标 commit 冲突的 untracked
   文件、备份 profile 文件、使用冻结 lockfile 安装依赖、构建 DSH Web 所需的
   host 和 client library artifacts，把完全匹配的旧 AWS overlay 迁移到受支持的
   profile bundle，并重新执行该 bundle 安装；
6. 通过 EC2 instance role 解析 Ark 引用，重启 `dsh.service`，检查 `3080` 端口，
   期望未认证根路径返回 HTTP `401`，并检查凭据形状的环境变量不存在。

工作流串行化，因此两个部署不会同时修改同一份 profile。远端脚本在切换
commit 后的步骤失败时回滚 Git revision 和 profile 文件。备份保留在主机的
`/var/lib/dsh-phase2/deploy-backups` 下。

一次性的旧 overlay 迁移会 fail closed：只有 user patch 的尾部与仓库内 AWS
worker bundle 逐字节一致时才会移除。任何自定义或有歧义的 overlay 都会停止部署，
并从 profile 备份恢复。

## 稳定的 Cloudflare ingress（主机一次性配置）

DSH 服务仍然只绑定 loopback。经过审查的 public path 是一个独立的
Cloudflare named tunnel：`dsh-ec2-phase2` 把
`dsh-web.useflinter.com` 转发到 `127.0.0.1:3080`，不需要为 EC2
security group 增加 ingress 规则。仓库中受保护的 tunnel 配置和 systemd unit 是：

- `cloudflared/dsh-ec2-phase2.yml`；
- `cloudflared/dsh-ec2-phase2-named-tunnel.service`；以及
- `systemd/10-dsh-web-public-host.conf`。

tunnel credential 永远不会存入 Git。配置主机前，由账户负责人把 credential
安全地放到 `/etc/cloudflared/dsh-ec2-phase2.json`，owner 为
`ubuntu:ubuntu`、权限为 `600`，并确保维护中的
`/home/ubuntu/bin/cloudflared` 存在。然后从 live checkout 以 root 执行仓库内
installer：

```bash
sudo env DSH_REPOSITORY_ROOT=/opt/dsh-phase2 \
  /opt/dsh-phase2/deploy/dsh-ec2/install-ingress.sh
```

installer 会校验 credential 权限、DSH 健康状态和 `cloudflared` ingress 语法，
只安装仓库中逐字匹配的文件，并启用 tunnel。它拒绝覆盖不一致的受管文件。
只有在审查现有文件后才可以显式使用 `--replace`；被替换的 unit/config/drop-in
会复制到主机上的带时间戳 backup。installer 不创建 DNS record 或 tunnel
credential；这些仍属于账户负责人的操作。

普通 deployment script 会在每次代码部署时执行更严格的 preflight：把 live
tunnel config、tunnel unit 和 DSH trusted-host drop-in 与请求的 deployment SHA
逐一比较，检查 tunnel credential 的 owner/权限和服务状态；任何不一致都会在
停止 DSH 之前失败。这样后续 deployment 或重新配置不会悄悄恢复过时的启动路径，
也不会丢失 stable hostname 的信任配置。

public hostname 仍然需要 DSH 的 authority-bound browser token 和 session cookie。
请为 stable hostname 创建新的 token；为 `127.0.0.1` 创建的 cookie 按设计不能用于
public authority。本仓库路径不会安装 Cloudflare Access policy。

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
