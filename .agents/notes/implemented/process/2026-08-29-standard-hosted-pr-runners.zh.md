# Agent Note: All DSH CI uses standard hosted runners

Status: implemented

[English](2026-08-29-standard-hosted-pr-runners.md) | 中文

## Problem

DSH 工作流选择了组织专用或自托管 runner 标签，而当前仓库的 Actions 容量不保证存在这些 runner。包括仅在 master 上运行的诊断任务和手动基准任务在内，任务都可能因没有可用 runner 而持续排队。

## Decision

所有 DSH 工作流的 runner 选择器都使用标准 GitHub 托管标签。pull request 的 Linux 工作和 Cloudflare 预览使用 `ubuntu-latest`，pull request 的 Windows 工作使用 `windows-latest`，master 串行参考和手动测量也使用相同的标准标签。手动测量现在报告标准托管容量，而不是依赖命名的大型 runner 池。工作流测试会拒绝 `self-hosted`、`dsh-*`、`vm-backup`、`dsh-win-ci` 以及旧的故障转移变量。

## Verification

工作流集合不再选择 `dsh-ubuntu-*`、`dsh-windows-*`、`vm-backup`、`dsh-win-ci` 或 `self-hosted`。当前排队中的运行不会因这项变更被修改或重试；需要新的运行才能观察标准托管 runner 路径。

## Alternatives considered

**保留自定义 runner 池并使用仓库变量故障转移。** 正常路径仍然依赖不可用的标签，并且必需检查能否启动会由仓库设置决定。

**为可选基准任务保留命名池。** 拒绝，因为手动工作流仍应能在没有组织专用 runner 注册的情况下从仓库运行。基准任务现在测量标准托管基线；未来的外部容量实验应在本仓库 CI 门禁之外进行。

## Consequences

标准托管 DSH 工作流无需组织专用 runner 注册即可启动。标准托管任务可能比原来的大型池运行更久，因此并发量和基准超时已相应限制。
