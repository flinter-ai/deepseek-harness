# Agent Note：将宽泛的 PR 门禁保留为本地检查

状态：已实现

[English](2026-08-30-pr-local-only-broad-gates.md) | 中文

## 问题

pull request 工作流在每个托管 runner 上运行整个仓库的覆盖率和消费者门禁。覆盖率门禁包含分片插桩和大量 shell 测试；消费者门禁包含记录会话、浏览器、兼容性、包、文档和构建产物检查。这些任务耗时较长，并且容易受到托管进程和快照环境差异的影响。

## 决策

必需的 pull request 结果只包含 Node 24 静态验证、无密钥 Python SDK 套件和 Linux release-shaped Python runtime 目标。完整覆盖率、快照和构建产物、额外 Node 版本、Windows/macOS 矩阵、基准测试、真实 provider 测试、Cloudflare 预览、AWS/Tower/Beam 检查和发布流程保留为仅本地、仅手动或仅 nightly 执行。

本地命令记录在 `.github/workflows/ci.yml` 中。托管任务被跳过表示 `NOT_RUN`，不能报告为通过。这些套件不得加入 pre-commit hook。

## 证据

在 PR #47 中，托管覆盖率门禁运行了 571 秒后因持久 PowerShell 状态断言失败。快照和构建产物门禁有三个记录会话断言失败，并在 346 秒后使浏览器快照门禁失败。这些失败不能证明 DSH archive 修改不正确；独立的本地聚焦测试以及 build/typecheck 门禁仍然分开。

## 结果

PR 审查获得短而确定的包完整性信号。在发布、切换或任何依赖完整覆盖率、记录快照、跨 runtime 兼容性、provider 行为或云端/平台证据的结论之前，仍必须运行仅本地的门禁。
