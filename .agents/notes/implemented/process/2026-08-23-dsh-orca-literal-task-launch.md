# Agent Note: DSH-Orca literal task launch

Status: implemented

English | [中文](2026-08-23-dsh-orca-literal-task-launch.zh.md)

## Problem

The Orca bridge receives a task as JSON, but `dsh-agent.mjs` previously inserted that task into a `bash -c` command. Shell substitutions inside valid task text, including Markdown backticks and `$()`, executed before the DSH CLI received the prompt. The worker then ran an incomplete task while Orca still showed a live dispatch.

## Decision

The task is carried in `DSH_TASK_SPEC` through the child-process environment. The shell source contains only a quoted reference to that variable. Paths, profile selection, and Orca correlation fields use the same environment channel, while the optional GMI environment file remains a fixed launcher-owned path.

`spawn-dsh-worker.mjs` resolves `dsh-agent.mjs` beside itself instead of assuming one global checkout. A feature worktree can therefore test and run its matching launcher without modifying another checkout.

## Alternatives considered

**Escape task text before inserting it into shell source.** Shell quoting is easy to regress when prompts contain nested Markdown and multiple shell metacharacters. Keeping the task out of shell source removes that class of failure instead of extending an escaping routine.

**Write every task to a temporary file and use command substitution.** Quoted command substitution can preserve literal output, but it adds file lifecycle and cleanup obligations. The child-process environment already provides a literal argument channel without another artifact.

## Consequences

- Markdown and shell-looking task text reaches DSH as one literal argument.
- The task is absent from generated shell source and cannot trigger shell evaluation.
- A keyless regression test executes the generated command with backticks and `$()` in the task and proves no marker command runs.
- Orca still owns the Run, Task, terminal, dispatch, and completion signals; this change only makes the worker launch transport literal.
