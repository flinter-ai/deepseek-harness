# Agent Note: 官方 CodeSandbox runtime

状态：已实现

[English](2026-09-12-codesandbox-sdk-runtime.md) | 中文

## 问题

platform-neutral compute contract 原来只有注入式 CodeSandbox interface。
这足够做 unit test，但没有把 DSH harness 接到真实 CodeSandbox VM；同时
vendor SDK 的 array command 形式也不能保持 literal argv 语义。

## 决策

`dsh-alpha-profile` 现在依赖官方 `@codesandbox/sdk`，并导出
`CodeSandboxSdkRuntime`。它创建 private、受限的 VM，把 profile 的大小写不
敏感 tier 名映射到 SDK `VMTier`，用 write session 连接，执行一个经过
shell-quote 且保留 literal argv 的 transport，并在 command 完成或停止后
shutdown VM。SDK API token 只属于 host；provider credential 和 token 都不能
进入 sandbox environment。

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

profile suite 与 SDK runtime unit tests 均通过。live no-credential E2E 创建了
private Pico sandbox，执行 literal argv payload，并成功 shutdown。API/CLI
workspace probe 也确认 shutdown 后 managed sandbox 仍出现在 workspace 中。
仓库没有保存 secret value，测试也不会输出 secret。
