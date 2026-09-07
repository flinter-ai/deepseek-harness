# Agent Note：通过 GitHub OIDC 和 SSM 自动部署 DSH Web EC2

状态：已实现

[English](2026-09-07-dsh-ec2-deployment.md) | 中文

## 问题

live DSH Web 主机此前通过手动 EC2/SSM 操作完成修复，但 source checkout 中还没有可重复的部署路径。这样未来的 profile 或 provider 修改可能与测试过的 source 发生漂移，手动重启也无法证明运行的是哪个精确 Git revision。

## 决策

增加一个仓库内 GitHub Actions 工作流：通过 GitHub OIDC 认证，检查 EC2 和 SSM 就绪状态，再通过 `AWS-RunShellScript` 发送精确 commit 的部署脚本。该脚本拒绝已停止的主机、SSM 离线目标、origin 不匹配或脏的 live checkout；备份 DSH profile；使用冻结 lockfile 安装；重新构建 AWS credential provider 和 FLINTER profile；重新执行 profile bundle 安装；验证 AWS reference 路径和未认证 Web 健康响应；如果切换 commit 后的步骤失败，则回滚 checkout/profile。

工作流有意不创建账户级 GitHub OIDC provider 或 IAM role。这些 trust 设置属于 AWS 基础设施负责人，必须带仓库和 ref 条件一次性配置。DSH Secrets Manager 读取仍由 EC2 instance role 授权，而不是 GitHub 部署 role。

## 考虑过的替代方案

**在 GitHub 中保存长期 AWS access key。** 否决：OIDC 可以消除常驻凭据，并将部署 role 与 DSH runtime secret 读取权限分开。

**引入 CodePipeline 或 CodeDeploy。** 否决：当前部署单元是一个 systemd 服务和一个 Git checkout；SSM 已能提供所需的精确 commit 和主机级事务，不必再引入第二个 application deployment plane。

**强制 reset live checkout 或自动启动 instance。** 否决：脏 checkout 可能含有 operator 数据，而启动停止的 EC2 是成本和可用性决策。工作流 fail closed，要求显式协调。

## 结果

配置受保护的 environment 和 IAM trust 后，`master` 的 push 可以部署 DSH Web source。部署串行化，可通过 commit 和 SSM command ID 审计，并在主机留下回滚备份。source 检查变绿不等于 live-cloud 证据；只有工作流到达目标并报告脱敏成功行才算。浏览器授权记录在重启之间仍保存在进程内，模型 API-key reference 继续在请求时从 Secrets Manager 解析。
