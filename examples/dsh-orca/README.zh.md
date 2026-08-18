# @flinter/dsh-orca —— 作为 Orca worker 宿主运行的 DSH

[English](README.md) | 中文

本目录包含 DeepSeek Harness（DSH）的 Orca 集成。它让 DSH 作为 headless worker，接收来自 Orca 的任务，并在完成后回告。

## 简单理解

把它想象成一家餐厅：

- **Orca** 是主厨 / 出票系统。它决定哪些订单需要烹饪、跟踪进度、知道每道菜何时完成。
- **DSH（DeepSeek Harness）** 是厨师。它实际干活：编辑文件、运行测试、写代码。
- **@flinter/dsh-orca** 是厨师的耳机和订单板。没有它，厨师听不到订单，主厨也听不到 "order up"。

## 任务在角色 2 中的流转

1. **你告诉 Orca："做这个工作。"**
   Orca 写一张 ticket，例如：*"重构 flinter-contracts 中的 error 模块。"*

2. **Orca 为 DSH 打开一个厨房工位。**
   它创建一个运行 headless DSH 的 terminal：
   ```bash
   orca terminal create --worktree id:<repo>::<path> \
     --command "node /Users/oldap/deepseek-harness/examples/dsh-orca/dsh-agent.mjs --model easy"
   ```

3. **Orca 把 ticket 滑进工位。**
   `dispatch --inject` 只对 Orca 内置 agent（claude、codex、cursor 等）有效。对 DSH，我们先 dispatch 用于跟踪，再自己发送任务 payload：
   ```bash
   orca orchestration dispatch --task <ticket-id> --to <dsh-terminal> --json
   orca terminal send --terminal <dsh-terminal> --text '<json-payload>' --enter --json
   ```
   JSON payload 携带 task ID、dispatch ID、run ID、coordinator handle 和任务 spec：
   ```json
   {
     "orchestration": {
       "runId": "run_...",
       "taskId": "task_...",
       "dispatchId": "ctx_...",
       "coordinator": "term_..."
     },
     "task": "refactor the error handling module"
   }
   ```

4. **DSH 读取 ticket。**
   `dsh-agent` 从 stdin 接收 payload，设置 `DSH_ORCA_*` 环境变量，并用任务 spec 作为 prompt 启动 headless DeepSeek Harness。

5. **DSH 干活。**
   它编辑文件、运行测试，等等。

6. **DSH 回告。**
   完成后，plugin 向 Orca 发送 `worker_done` 消息：*"我成功了。修改了 A、B 文件。测试通过了。"*
   Orca 将该任务标记为完成。

## 便捷启动器

`spawn-dsh-worker.mjs` 用一个命令完成整个流程：

```bash
cd ~/deepseek-harness
node examples/dsh-orca/spawn-dsh-worker.mjs \
  --objective "Refactor error handling" \
  --spec "Split errors.ts into domain modules" \
  --model hard \
  --dest /Users/oldap/flinter/flinter-contracts \
  --prompt-file /path/to/contract.md
```

然后等待完成：

```bash
orca orchestration check --run <run_id> --wait --types worker_done --timeout-ms 240000 --json
```

## 起飞前安全检查

在创建 worker terminal 之前，`spawn-dsh-worker.mjs` 会像通用 `orchestration` skill 要求的那样检查目标仓库：

- 用 `git rev-parse --show-toplevel` 解析仓库根目录
- 记录 branch、HEAD、upstream 和 `git status --porcelain=v1 -b`
- fetch `origin` 并将 HEAD 与 `origin/main` 比较
- 如果树 **diverged** 自 `origin/main` 则拒绝启动
- 如果树 **dirty** 且未传 `--allow-dirty` 则拒绝启动

这保护目标仓库不会在一个未提交或未分类的状态下被写入。如果触发 dirty 停止，选择以下之一：

1. 提交或暂存变更，然后重新运行。
2. 如果脏文件与任务无关且你接受风险，使用 `--allow-dirty` 重新运行。

脚本不会自动提交、自动暂存或重置目标树。

## 模型路由

worker home（`worker-home.mjs`）配置 DSH 可以调用的模型。当前路由：

| label | provider / model | 用途 |
|---|---|---|
| `easy`（默认） | opencode-go / `deepseek-v4-flash` | 快速/低成本工作（经网关使用 DeepSeek） |
| `easy-backup`、`backup` | gmi-serving / `deepseek-ai/DeepSeek-V4-Flash-0731` | `easy` 的运营 fallback |
| `hard` | kimi-coding / `k3-256k` | 强力编程模型 |
| `hard-backup` | opencode-go / `glm-5.3` | Kimi 失败时的 fallback |
| `glm-5.3` | opencode-go / `glm-5.3` | 显式 GLM 档位 |
| `nadirclaw` 等 | NadirClaw localhost router | 本地验证 agent |

`dsh-agent` 只对 provider、配额、404/未授权、not-supported 和 transport 失败（`stream ended`、`finish_reason`、`transport`）重试一次。`NO_ADAPTER` 和本地配置错误 **不会** 触发 fallback。

### 混合协议 provider

DSH `llm-pi-ai` 支持按模型 `api` 选择（`model.api ?? provider.api`），因此单个 provider 路由可以托管使用不同 wire protocol 的模型。`opencode-go` 路由保持 `api: openai-completions` 作为默认值，并可在需要时将单个模型声明为 `api: openai-responses`。这使 provider 身份与 wire protocol 保持分离，无需捏造伪 provider 路由。

## 本地运行与切换模型

### 前置条件

1. 安装依赖并构建 DSH：

   ```bash
   cd ~/deepseek-harness
   git checkout flinter/dsh-orca-plugin
   pnpm install
   pnpm run build
   ```

2. 将密钥存入 `~/.dsh/.credentials.yaml`：

   ```yaml
   DEEPSEEK_API_KEY: sk-…
   OPENCODE_GO_API_KEY: sk-…
   GMI_SERVING_API_KEY: sk-…
   KIMI_CODING_API_KEY: sk-…
   ```

   GMI 也会读取 `~/.flinter/gmi-env.sh`；`dsh-agent` 会自动 source 它。

### 运行 Web UI

```bash
pnpm dsh web
```

打开 `http://127.0.0.1:3080`。模型选择器会显示所有已配置的 provider。

### 以指定模型运行 headless

```bash
# easy (default): opencode-go / deepseek-v4-flash
pnpm dsh --profile headless "your task here"

# hard: kimi-coding / k3-256k
pnpm dsh --profile headless --model hard "your task here"

# explicit GLM tier: opencode-go / glm-5.3
pnpm dsh --profile headless --model glm-5.3 "your task here"
```

### 在 Web UI 中切换模型

在 Web UI 中打开模型选择器（TUI 中的 `/model`，或 Web 侧边栏的模型选择器），选择任意已配置的 provider/model 组合。该选择是按会话的，不会修改 `settings.yaml`。

### 通过编辑 settings 切换模型

编辑 `~/.dsh/settings.yaml` 并修改 `agent-default-model`：

```yaml
agent-default-model:
  provider: opencode-go
  model: deepseek-v4-flash
```

重启 DSH 后生效。

### 验证每个密钥可用

对每个 provider 运行一行 headless prompt：

```bash
# opencode-go / deepseek-v4-flash
pnpm dsh --profile headless --model easy "Say OK"

# gmi-serving / deepseek-ai/DeepSeek-V4-Flash-0731
pnpm dsh --profile headless --model easy-backup "Say OK"

# kimi-coding / k3-256k
pnpm dsh --profile headless --model hard "Say OK"

# opencode-go / glm-5.3
pnpm dsh --profile headless --model glm-5.3 "Say OK"
```

每个都应打印简短回复。`QUOTA` 或 `AUTH` 错误表示密钥缺失或已耗尽；`NO_ADAPTER` 错误表示 `settings.yaml` 中未声明该 provider。

## Credentials

API key 从 `~/.dsh/.credentials.yaml`（由 harness 管理）和 GMI-serving 的 `~/.flinter/gmi-env.sh` 读取。plugin 不会把 key 存进仓库文件。`dsh-agent` 在启动 DSH 前 source `~/.flinter/gmi-env.sh`，这样 `GMI_SERVING_API_KEY` 可用，而 plugin 不读取该文件。

如果你误把 key 文件加进了仓库，确保它在 `.gitignore` 中并且绝不提交。

## `~/deepseek-harness` 的三个角色

| 角色 | 它是什么 | 所在位置 |
|---|---|---|
| 角色 1 —— 交互式编程 harness | 你打开进行人工驱动任务的 DSH Web UI | `master` branch |
| 角色 2 —— Orca subagent worker 宿主 | 这个 headless DSH + Orca plugin | `flinter/dsh-orca-plugin` branch，`examples/dsh-orca/` |
| 角色 3 —— 生产容器运行时 | AWS/GMI 容器内的 `dsh-segment` | `flinter/dsh-segment` branch，`examples/dsh-segment/` |

角色 2  purely local。它不触碰 AWS 或生产 segment。
