# CI runner contract

[English](CI_RUNNER_CONTRACT.md) | 中文

## Linux x64

能够在 Linux x64 上运行的仓库任务使用已注册的 AWS EC2 自托管 runner：

```yaml
runs-on: [self-hosted, linux, x64, ci-linux]
```

由生成矩阵接收的任务可以通过 `ci-linux` 自定义标签选择同一个 runner。该标签是仓库专用的，避免任务落到无关的自托管机器上。

该 runner 是信任边界。它必须专用于本仓库，在任务之间保持干净（优先使用临时镜像或等效重置），并且不得保存长期 AWS、GitHub、npm 或服务商凭据。执行仓库代码的 CI checkout 必须关闭持久化 Git 凭据。受保护的部署和发布环境仍负责各自的 GitHub 环境审批以及 OIDC/令牌策略。

## 平台例外

当前 EC2 runner 仅支持 Linux x64。因此，原生平台任务继续使用能够执行它们的平台：

- `ubuntu-24.04-arm` 用于 Linux ARM64 原生构建；
- `windows-latest` 或 `windows-2025` 用于原生 Windows 构建和测试；
- `macos-latest` 用于原生 macOS 构建和测试。

这些例外是有意保留的，并由 runner policy 检查；它们不会把 Linux x64 CI gate 移回 GitHub 托管基础设施。

## 验证

`pnpm run verify-ci-runner-policy` 会检查所有 workflow 的 runner selector。policy 检查通过只证明仓库内 selector 已获批准，并不证明 GitHub 中存在已注册且在线的 runner。runner 注册、标签、服务健康状态以及成功的 workflow dispatch 必须在 GitHub 组织中另行验证。
