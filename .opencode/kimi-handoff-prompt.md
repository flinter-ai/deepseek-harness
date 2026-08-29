# Handoff from pi — DSH-Orca native worker launch (flinter/dsh-orca-plugin)

You are continuing work previously handled by pi. Read this prompt and the
sibling `handoff.json` in the same directory, then proceed with the next
actions below.

Project: /Users/oldap/deepseek-harness
Branch: flinter/dsh-orca-plugin
HEAD: 2e8c89af3c04578cf6ae0ac9a113a6e4c4f51de5
Scope: `examples/dsh-orca/` only. Do not touch `flinter/dsh-segment`, `master`, or DSH core in this task.

## What was already done (verified)

- Native Orca → DSH launch seam works end-to-end:
  `spawn-dsh-worker.mjs` creates run/task, creates an Orca terminal with
  `--command "node examples/dsh-orca/dsh-agent.mjs --model <m> --home <h>"`,
  dispatches (no `--inject`; DSH is not a recognized Orca agent CLI), and sends
  a JSON payload to the terminal. `dsh-agent` parses it from stdin, prepares an
  isolated DSH_HOME via `worker-home.mjs`, launches headless DSH with
  `TSX_TSCONFIG_PATH` pinned, and the harness's `@flinter/dsh-orca` plugin
  returns `worker_done` to the Run. Observed live: `worker_done(succeeded)`
  with summary "Replied hello as requested."
- Git preflight in `spawn-dsh-worker.mjs` (root/branch/HEAD/upstream/dirty,
  origin/main divergence). Refuses dirty tree unless `--allow-dirty`.
- `dsh-agent` fallback: one provider retry on quota/429/404/unauthorized/
  not-supported AND transport failures (stream ended, finish_reason,
  transport). `NO_ADAPTER` and local config errors do NOT fall back — keep it
  that way. Failure is reported to Orca as `worker_done(failed)`.
- Raw provider probes (evidence):
  - `gpt-5.6-luna` on opencode-go chat/completions generates content but every
    stream chunk has `finish_reason: null` → pi-ai throws "Stream ended without
    finish_reason".
  - The same model on `/v1/responses` completes cleanly
    (`response.completed`).
  - opencode-go registry (`~/.cache/opencode/models.json`): 26 bare model IDs;
    `gpt-5.6-luna` and `grok-4.5` are `@ai-sdk/openai` (Responses API);
    everything else is `openai-compatible` (chat/completions).
  - Real Luna card: contextWindow 1050000 (input cap 922000), maxTokens 128000,
    input text/image/pdf, temperature unsupported, reasoning true.
- README.md written with the three-role architecture and the restaurant
  analogy.

## Current blocker (the crux)

- Desired routing (user-fixed, do NOT change to make tests green):
  - `easy` primary → `opencode-go / gpt-5.6-luna`
  - `easy-backup` → `gmi-serving / deepseek-ai/DeepSeek-V4-Flash-0731`
  - `hard` primary → `kimi-coding / k3-256k`
  - `hard-backup` → `opencode-go / glm-5.3`
- DSH pi-ai selects `api` at **ProviderSpec level**; `modelOverrides` has no
  `api` field. So Luna (Responses) and GLM-5.3 (Completions) cannot coexist
  under one `opencode-go` provider today.
- An isolated disposable-home diagnostic of `opencode-go +
  api:openai-responses + gpt-5.6-luna` FAILED with
  `NO_ADAPTER: no adapter registered for provider "opencode-go"`. So
  Luna+Responses does NOT pass in current DSH either — the Responses adapter
  path for config-declared providers itself needs diagnosis inside
  `packages/llm/llm-pi-ai` (the PROTOCOLS table lists `openai-responses`, but
  the LLM seam reports no adapter registered; start at
  `packages/llm/llm-pi-ai/src/provider.ts` and
  `packages/llm/llm/src/index.ts` line ~818).
- Do NOT invent pseudo-providers like `opencode-go-responses` again — that was
  tried and reverted.

## Next actions (in order)

1. **Fix `examples/dsh-orca/worker-home.mjs` routing (final form):**
   - `easy: { provider: 'opencode-go', model: 'gpt-5.6-luna' }`
   - `easy-backup` / `backup`: `gmi-serving / deepseek-ai/DeepSeek-V4-Flash-0731`
   - `hard`/`kimi`: `kimi-coding / k3-256k`
   - `hard-backup`/`glm-5.3`: `opencode-go / glm-5.3`
   - Add `gpt-5.6-luna` to the `OPENCODE_GO_MODELS` list in settings.yaml
     generation with the REAL card (1050000 ctx, 128000 maxTokens,
     `input: [text, image, pdf]`) and a comment marking it BLOCKED pending
     per-model api support. Right now `easy` temporarily points at
     `gmi-serving` — revert that; Luna stays primary with the operational
     fallback executing.
2. **Acceptance test:** run `spawn-dsh-worker.mjs --model easy --allow-dirty
   --dest <a repo Orca knows, e.g. /Users/oldap/flinter>` with a trivial
   prompt. Expect: Luna attempt fails with the stream transport error →
   classifier retries `easy-backup` → GMI succeeds → `worker_done(succeeded)`
   visible via
   `orca orchestration check --run <run> --terminal <coordinator-handle> --wait --types worker_done --timeout-ms 240000 --json`.
3. **Open a separate DSH-side task** (outside `examples/dsh-orca/`): diagnose
   the `openai-responses` NO_ADAPTER path, then evaluate the minimal delta
   `model.api ?? provider.api` so one provider can mix protocols. Do not do
   this inside the Orca example.
4. **Classifier regression guard:** transport failures (stream ended /
   finish_reason / transport) must stay fallback-eligible; `NO_ADAPTER` must
   stay non-fallback.
5. **README:** document Luna BLOCKED status (desired vs operational routing)
   — some of this is already drafted, verify it matches the final routing.
6. **Commit** on `flinter/dsh-orca-plugin` with `Task:` / `Evidence:` trailers.

## Hard rules (from the FLINTER instructions)

- Never read/print/copy credentials (`~/.dsh/.credentials.yaml`,
  `~/.flinter/gmi-env.sh`, `~/.ssh`, `.env`). `dsh-agent` only *sources*
  `gmi-env.sh`.
- Never `git reset --hard` / `git clean -f` on a dirty worktree.
- One writer per worktree; commit WIP before handoff.
- A `worker_done` without named artifacts is unverified input; absence of a
  signal is not evidence of failure.

## Start here

Confirm you understand the state (reply with a 3-line summary of the routing
policy, the Luna blocker, and the acceptance test), then do action 1 and run
the acceptance test in action 2.
