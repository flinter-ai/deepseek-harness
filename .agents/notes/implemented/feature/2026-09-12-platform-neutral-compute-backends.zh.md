# Agent Note: 平台中立且有界的 compute backend

Status: implemented

[English](2026-09-12-platform-neutral-compute-backends.md) | 中文

## Problem

DSH harness 需要在有界 sandbox、现有 EC2 主机或本地开发进程上运行相同的
worker contract。若把 substrate 写死在 runner 中，或把新的 sandbox 当作无限制
进程启动，会使 web 与 EC2 路径分叉，并可能意外产生 compute burst。

## Decision

`dsh-alpha-profile` 负责平台中立的 compute contract，支持明确的
`codesandbox`、`ec2` 与 `local` backend。新启动默认使用 `codesandbox`；EC2
systemd overlay 选择 `ec2`，本地启动可以通过 `DSH_COMPUTE_BACKEND` 选择其他
backend。未知值会 fail closed，不会静默回退。

profile 提供一个进程内 admission guard，默认最多一个 active attempt、每个
backend 最多一个 active attempt、30 分钟 wall bound、五分钟 idle bound，以及
五分钟 sandbox hibernation timeout。它执行每个 session 一个 active attempt、总量
与每个 backend 的 capacity，以及 lease-current 检查。它是 adapter guard，不取代
control plane 的持久 admission 与 fencing。较早的
[bounded background-job admission decision](../../bug-fix/2026-08-11-bounded-background-job-admission.md)
仍负责 Task-backed background job。

CodeSandbox adapter 接收注入的窄 runtime interface，而不让 profile 依赖厂商 SDK。
它在有界 VM 中用一个 literal argv 启动任务，在完成或停止后释放 VM，并拒绝带有
credential 形状的 environment 名称。可以传递非敏感的 secret reference 名称；真正
的 secret value 仍由选定的 host/runtime 负责。attempt manifest 与 launch environment
记录所选 backend，因此后续 worker 不会被误认为运行在其他 substrate 上。该 contract
扩展了[可复现 EC2 deployment decision](../../process/2026-09-07-dsh-ec2-deployment.md)，
但不改变其 exact-SHA 与 fail-closed deployment 规则。

本 contract 不声称已经完成真实 CodeSandbox provider 集成：host 仍须注入 runtime
实现，control plane 仍须提供跨进程 durable admission、fencing、storage 以及成本／
账户策略。

## Alternatives considered

**只实现 CodeSandbox worker。** 拒绝，因为 EC2 已经是运行中的 substrate，本地执行
仍然是开发与确定性测试所必需的。

**让每个 launcher 自己发明 environment 与 admission 规则。** 拒绝，因为 web、EC2
与本地运行会记录不同的 identity，并可能绕过相同的 session 与 capacity 保证。

**把 CodeSandbox SDK 直接引入 profile package。** 拒绝，因为可选的厂商 SDK 与其
凭据属于 host deployment；注入窄 interface 可以保持核心 profile portable 且无密钥。

**把进程内 admission 当成分布式锁。** 拒绝，因为它不能协调多个 web／EC2 process。
生产环境多主机使用仍需要 durable control-plane admission 与 fencing。

## Consequences

web 路径拥有有界的默认 substrate，EC2 可以通过配置选择，不需要维护第二套 worker
实现。每个 attempt 都带有 backend identity，因此 backend 变更可观察、可回放。保守
默认可能在 operator 明确提高 capacity 前拒绝并发工作；CodeSandbox adapter 在其
runtime 与 storage contract 实现前仍是 host integration seam。

## Testing

compute、attempt、worker 与 local-harness 套件通过，共 31 个 focused tests。覆盖
backend parsing、默认与显式限制、重复与同 session admission、总量／backend capacity、
lease release、backend stamping、adapter 选择、literal argv、VM dispose、hibernation
设置以及 credential 形状 environment 拒绝。测试注入 fake CodeSandbox runtime，不访问
真实 provider。
