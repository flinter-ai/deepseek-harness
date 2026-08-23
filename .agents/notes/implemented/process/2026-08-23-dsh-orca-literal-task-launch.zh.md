# Agent Note：DSH-Orca 字面任务启动

状态：已实现

[English](2026-08-23-dsh-orca-literal-task-launch.md) | 中文

## 问题

Orca bridge 通过 JSON 接收任务，但 `dsh-agent.mjs` 之前会把任务直接插入 `bash -c` 命令。合法任务文本中的 shell 替换，包括 Markdown 反引号和 `$()`，会在 DSH CLI 收到 prompt 前执行。worker 随后运行残缺任务，而 Orca 仍显示一个活跃 dispatch。

## 决策

任务通过子进程环境中的 `DSH_TASK_SPEC` 传递。shell 源码只包含对该变量的带引号引用。路径、profile 选择和 Orca 关联字段使用同一环境通道；可选的 GMI 环境文件仍由 launcher 拥有固定路径。

`spawn-dsh-worker.mjs` 改为解析与自身同目录的 `dsh-agent.mjs`，不再假设唯一全局 checkout。因此 feature worktree 可以测试并运行与其代码匹配的 launcher，而不修改其他 checkout。

## 考虑过的替代方案

**转义任务文本后再插入 shell 源码。** 当 prompt 包含嵌套 Markdown 和多种 shell 元字符时，shell quoting 很容易再次回归。让任务完全不进入 shell 源码，可以消除这一类故障，而不是继续扩展转义逻辑。

**把每个任务写入临时文件并使用命令替换。** 带引号的命令替换可以保留字面输出，但会增加文件生命周期和清理义务。子进程环境已经提供字面参数通道，不需要额外工件。

## 结果

- Markdown 和看似 shell 的任务文本会作为一个字面参数到达 DSH。
- 任务不会出现在生成的 shell 源码中，因此无法触发 shell 求值。
- keyless 回归测试使用包含反引号和 `$()` 的任务执行生成命令，并证明没有 marker 命令运行。
- Orca 仍拥有 Run、Task、terminal、dispatch 和完成信号；本改动只保证 worker 启动传输是字面的。
