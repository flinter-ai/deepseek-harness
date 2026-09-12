# Agent Note: 官方 CodeSandbox runtime

状态：已实现

[English](2026-09-12-codesandbox-sdk-runtime.md) | 中文

## 问题

platform-neutral compute contract 原来只有注入式 CodeSandbox interface。
这足够做 unit test，但没有把 DSH harness 接到真实 CodeSandbox VM；同时
vendor SDK 的 array command 形式也不能保持 literal argv 语义。

## 决策

`dsh-alpha-profile` 现在依赖官方 `@codesandbox/sdk`，并导出
`CodeSandboxSdkRuntime`。它创建 private、受限的 CodeSandbox sandbox（底层由
CodeSandbox 使用 microVM 实现），把 profile 的大小写不敏感 tier 名映射到
SDK `VMTier`，用 write session 连接，执行一个经过 shell-quote 且保留
literal argv 的 transport，并在 command 完成或停止后 shutdown sandbox。SDK
API token 只属于 host；provider credential 和 token 都不能
进入 sandbox environment。

如果 host 提供 `workspaceSeed`，runtime 会将只来自 tracked files 的 source
archive 写入 sandbox，校验 archive SHA-256 与精确 source SHA，然后在执行
前解包到 `/project/sandbox`。`templateId` 仍只是可选的 CodeSandbox
bootstrap/fork 来源，不是 GitHub source of truth。

官方 `csb` CLI 继续作为 list 和 sandbox lifecycle/preview 资源管理入口。
它不替代 SDK command adapter，因为它不提供这里需要的 runtime object。
EC2 仍在受保护的 systemd drop-in 中选择 `DSH_COMPUTE_BACKEND=ec2`；
CodeSandbox 默认值不会覆盖这个 host 设置。

## 结果

DSH runner 无需修改，也无需维护第二套 worker implementation，harness 已有
真实 CodeSandbox execution path。local admission 仍只是进程内证据；在
provider-backed CodeSandbox worker 可用于生产前，仍需要持久化的多主机
admission/fencing 以及经过审查的短期 model-credential broker。
CodeSandbox shutdown/resume 只在 CodeSandbox 内保留文件；持久化的 session
JSONL、manifest 和 artifact 仍需要 AWS storage adapter 或经过审查的共享挂载。

## 测试

profile suite 与 SDK runtime unit tests 均通过，包括 tracked source archive
seed 路径。之前的 live no-credential E2E 创建了 private Pico sandbox，执行
literal argv payload，并成功 shutdown。之后的完整 source-seed/template-fork
probe 在创建 sandbox 前被 CodeSandbox workspace 的 spending limit 冻结拦截。
仓库没有保存 secret value，测试也不会输出 secret。
