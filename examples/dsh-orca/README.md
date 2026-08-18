# @flinter/dsh-orca — DSH as an Orca worker host

English | [中文](README.zh.md)

This directory contains the Orca integration for the DeepSeek Harness (DSH).
It lets DSH act as a headless worker that receives tasks from Orca and reports
back when it is done.

## The idea, explained simply

Think of it like a restaurant:

- **Orca** is the head chef / ticket system. It decides what orders need to be
cooked, tracks what is in progress, and knows when each dish is done.
- **DSH (DeepSeek Harness)** is the cook. It actually does the work: edits
files, runs tests, writes code.
- **@flinter/dsh-orca** is the cook's headset and order pad. Without it, the
cook cannot hear the ticket, and the chef cannot hear "order up."

## How a task flows through role 2

1. **You tell Orca: "Do this job."**
   Orca writes a ticket, for example: *"Refactor the error module in
   flinter-contracts."*

2. **Orca opens a kitchen station for DSH.**
   It creates a terminal running DSH in headless mode:
   ```bash
   orca terminal create --worktree id:<repo>::<path> \
     --command "node /Users/oldap/deepseek-harness/examples/dsh-orca/dsh-agent.mjs --model easy"
   ```

3. **Orca slides the ticket into the station.**
   `dispatch --inject` only works for Orca's built-in agents (claude, codex,
   cursor, etc.). For DSH we dispatch for tracking and then send the task
   payload ourselves:
   ```bash
   orca orchestration dispatch --task <ticket-id> --to <dsh-terminal> --json
   orca terminal send --terminal <dsh-terminal> --text '<json-payload>' --enter --json
   ```
   The JSON payload carries the task ID, dispatch ID, run ID, coordinator
   handle, and the task spec:
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

4. **DSH reads the ticket.**
   `dsh-agent` receives the payload on stdin, sets the `DSH_ORCA_*`
   environment variables, and execs the headless DeepSeek Harness with the
   task spec as its prompt.

5. **DSH does the work.**
   It edits files, runs tests, and so on.

6. **DSH reports back.**
   When finished, the plugin sends a `worker_done` message to Orca:
   *"I succeeded. Files changed: A, B. Tests passed."*
   Orca marks the task complete.

## Convenience launcher

`spawn-dsh-worker.mjs` performs the whole flow in one command:

```bash
cd ~/deepseek-harness
node examples/dsh-orca/spawn-dsh-worker.mjs \
  --objective "Refactor error handling" \
  --spec "Split errors.ts into domain modules" \
  --model hard \
  --dest /Users/oldap/flinter/flinter-contracts \
  --prompt-file /path/to/contract.md
```

Then wait for completion:

```bash
orca orchestration check --run <run_id> --wait --types worker_done --timeout-ms 240000 --json
```

## Preflight safety check

Before creating the worker terminal, `spawn-dsh-worker.mjs` inspects the
destination repository exactly like the general `orchestration` skill requires:

- resolves the repo root with `git rev-parse --show-toplevel`
- records branch, HEAD, upstream, and `git status --porcelain=v1 -b`
- fetches `origin` and compares HEAD against `origin/main`
- refuses to launch if the tree is **diverged** from `origin/main`
- refuses to launch if the tree is **dirty** unless you pass `--allow-dirty`

This protects the destination from a worker writing into an uncommitted or
unclassified state. If you hit the dirty stop, choose one of:

1. Commit or stash the changes, then re-run.
2. Re-run with `--allow-dirty` if the dirty files are unrelated to the task
   and you accept the risk.

The script never auto-commits, auto-stashes, or resets the destination tree.

## Model routing

The worker home (`worker-home.mjs`) configures the models DSH can call.
Current routing:

| label | provider / model | use |
|---|---|---|
| `easy` (default) | deepseek-official / `deepseek-v4-flash` | fast/cheap work (direct DeepSeek API) |
| `easy-backup`, `backup` | gmi-serving / `deepseek-ai/DeepSeek-V4-Flash-0731` | operational fallback for `easy` |
| `hard` | kimi-coding / `k3-256k` | strong coding model |
| `hard-backup` | opencode-go / `glm-5.3` | fallback when Kimi fails |
| `glm-5.3` | opencode-go / `glm-5.3` | explicit GLM tier |
| `nadirclaw` etc. | NadirClaw localhost router | local verification agents |

`dsh-agent` retries once with the configured fallback only for provider,
quota, 404/unauthorized, not-supported, and transport failures (`stream ended`,
`finish_reason`, `transport`). `NO_ADAPTER` and local configuration errors do
NOT trigger a fallback.

### Mixed-protocol providers

DSH `llm-pi-ai` supports per-model `api` selection (`model.api ?? provider.api`),
so a single provider route can host models that speak different wire protocols.
The `opencode-go` route keeps `api: openai-completions` as its default and can
declare individual models with `api: openai-responses` when needed. This keeps
provider identity separate from wire protocol and avoids inventing pseudo-provider
routes.

## Credentials

API keys are read from `~/.dsh/.credentials.yaml` (managed by the harness) and
from `~/.flinter/gmi-env.sh` for GMI-serving. The plugin never stores keys in
repo files. `dsh-agent` sources `~/.flinter/gmi-env.sh` before launching DSH so
`GMI_SERVING_API_KEY` is available without the plugin reading the file.

If you add a key file inside the repo by mistake, make sure it is in
`.gitignore` and never commit it.

## The three roles of `~/deepseek-harness`

| Role | What it is | Where it lives |
|---|---|---|
| Role 1 — Interactive coding harness | The DSH Web UI you open for human-driven tasks | `master` branch |
| Role 2 — Orca subagent worker host | This headless DSH + Orca plugin | `flinter/dsh-orca-plugin` branch, `examples/dsh-orca/` |
| Role 3 — Production container runtime | `dsh-segment` inside AWS/GMI containers | `flinter/dsh-segment` branch, `examples/dsh-segment/` |

Role 2 is purely local. It does not touch AWS or the production segment.
