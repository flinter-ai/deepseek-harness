# Agent Note: Pull request CI 中的无密钥敏感信息扫描

Status: implemented

[English](2026-08-29-keyless-secret-scanning-ci.md) | 中文

## Problem

公开仓库已经启用了 GitHub secret scanning，但 pull request CI 尚未独立阻止新加入的凭据；默认检测器还会把合成的脱敏测试值和生成的文档哈希记录报告为通用密钥。

## Decision

Pull request、分支推送、手动触发和每周定时的 CI 运行两个无密钥扫描器。Gitleaks v8.30.1 扫描当前工作树和变更提交范围，并使用脱敏输出。TruffleHog v3.97.1 扫描提交范围中的已验证凭据。两个任务都只有只读 contents 权限，使用固定的 action 或镜像版本，并且不会接收 provider 或仓库密钥。

仓库的 Gitleaks 配置只允许 i18n YAML 文件中由 Markdown 文件名和 40 位小写十六进制 blob 哈希组成的精确生成双语记录行。两个现有的密钥形状脱敏测试夹具带有行内 `gitleaks:allow` 标记，并继续作为仅测试值使用。没有使用按目录或按检测器的宽泛抑制。

现有的真实 provider 工作流仍然负责受保护的凭据测试。扫描工作流不会检查或使用这些密钥，其策略步骤会拒绝向扫描工作流加入 `pull_request_target` 或 `secrets.*` 引用。

## Alternatives considered

**只依赖 GitHub secret scanning。** 否决，因为仓库所有者告警不等于必需的 pull request 状态，也不提供本仓库使用的本地误报策略。

**允许所有文档、测试或 i18n 文件。** 否决，因为宽泛的路径例外可能隐藏真实凭据。采用的例外只匹配生成的哈希记录行或明确标记的夹具。

**向 CI 暴露扫描器许可证或 provider 密钥。** 否决，因为扫描源码不需要应用凭据，而且安全门必须能够安全运行于 fork pull request。

**删除 docs 目录。** 否决，因为被标记的文档文件是受跟踪的架构资料和生成的配对记录；删除它们会丢失仓库资料，而不是解决凭据暴露问题。

## Consequences

工作树或变更提交范围中出现的新凭据会使 CI 失败，而不会打印其值。现有合成夹具仍可用于脱敏测试，并且有明显分类。历史 GitHub secret-scanning 告警和 provider 特定的轮换决策仍属于独立的运维责任；本变更不宣称通用检测器发现就是已确认的真实密钥。
