# Agent Note: Agentic-control P0 — typed investigation state with authoritative projection

Status: implemented

English | [中文](2026-08-18-dsh-agentic-control-p0.zh.md)

## Problem

FLINTER video-review work runs candidate investigations whose physical-evidence state must survive compaction, replay, and resume while remaining visible to the model as authoritative context. Before this change the harness had no typed seam for that: an ad-hoc implementation would have put mutable state in a plugin-local variable, where it is invisible to replay, lost on restore, and indistinguishable from model-injected text. The model also needs bounded macro-actions — assess, finish, stop-unknown — that change that state only through validated, logged transitions, never through prompt text alone.

## Decision

Two packages under `packages/agentic-control/` implement the seam.

### `@deepseek-ai/dsh-agentic-control` — the service

`InvestigationService` (`packages/agentic-control/agentic-control/src/index.ts`) owns one investigation per agent, folded from durable `investigation/change` session events (`INVESTIGATION_CHANGE_VERSION = 1`). `src/types.ts` holds the pure domain types: `InvestigationState` with candidate, evidence requirements and derived status, physical-assessment fields, lineage, budget, and phase (`active`/`finished`/`stopped-unknown`). `src/fold.ts` is the strict decoder plus transition-validating fold: `decodeInvestigationChange` rejects malformed payloads, and the fold rejects out-of-order revisions and illegal phase transitions rather than repairing them.

Mutations go through `commit()`, which dry-run folds the proposed change before appending it, so malformed provider output never reaches the log. A throwing physical-assessment provider still commits a budget-consuming `assess-failed` change before the error propagates; a provider whose result fails validation throws `INVESTIGATION_INVALID_RESULT` and consumes nothing. Assessment providers are registered through `registerProvider()` (returns a disposer) and resolved lazily at the first assessment against the validated `provider` config field; `maxAttempts` defaults to 3. A package invariant companion replays each session's fold independently and compares it against the live service state.

### `@deepseek-ai/dsh-tool-agentic-control` — the model surface

The function plugin contributes three macro-action tools over the service and one system-prompt section (`tool:agentic-control`, order 115). `run_physical_assessment` executes one assessment against the configured provider. `finish_investigation` and `stop_unknown` commit the terminal transition, conclude the turn through `exec.concludeTurn()`, and return the literal resulting phase. A terminal `ctx.tools.guard` denies all three tools whenever the investigation phase is not `active`, so a finished investigation cannot be re-entered through stale model output.

Every call requires `exec.agent`; `INVESTIGATION_TOOL_NO_AGENT` fires otherwise. The authoritative projection is a prepended `agent/pre-step` listener that renders the current state and appends it as a durable, source-attributed `user/message` (`source.plugin === 'tool-agentic-control'`), deduplicated per session by a `WeakMap`-held revision counter so a step never re-projects an unchanged revision. Because the projection is a logged message, it satisfies the model-visible ⟺ logged invariant and replays exactly.

## Testing

Unit coverage (95 tests, 100% on both packages' `src`) pins the decoder and fold strictness table, every service transition including failing, garbage, and partial providers, budget accounting, lazy provider resolution, disposer behavior, the invariant's independent fold, guard denial outside the active phase, projection rendering and dedupe, and the terminal tools' turn conclusion. The P0.6 acceptance test (`examples/aws-headless/tests/agentic-trajectory.e2e.ts`) boots the real composed aws-headless profile in-process with the llm-replay waterfall as the model: a privileged `start`, a replayed `run_physical_assessment`, and a `finish_investigation` produce exactly `start → assess → finish` changes, the strict fold equals the live service view, two projection messages enter durable history, and the Bedrock, Secrets Manager, and Orca capabilities compose intact beside the seam. The session-title provider is disabled in that profile because its own model call would consume a scripted replay entry.

## Alternatives considered

- **Mutable plugin-local state with prompt-only visibility** — rejected because it is invisible to replay, lost on restore, and violates model-visible ⟺ logged.
- **Letting the model start investigations** — rejected; `start` is a privileged host channel so candidate selection cannot be manufactured by model output.
- **Repair-tolerant fold** — rejected because silently corrected transitions would let malformed provider output rewrite durable history.
- **Retrying failed assessments without consuming budget** — rejected for provider throws; an attempted assessment is a real attempt, while invalid results are rejected before any budget is spent.

## Consequences

- Investigation state is durable, replayable, and authoritative in model context; compaction and resume reconstruct it exactly.
- The model can assess, finish, or stop-unknown but cannot start investigations, mutate fields directly, or act outside the active phase.
- Provider selection and attempt budget are validated config, changeable per deployment from cordis.yml.
- Physical-assessment providers plug in through registration without touching the service or tools.

## Known limitations and deferred work

- Only the `stub` provenance provider ships in P0; a real physical-assessment provider is a separate package.
- A formal stream-json snapshot fixture through the keyless ACP/headless replay harness is deferred; the trajectory e2e already covers the assembled transcript through the real composed profile.
- One investigation per agent; multi-candidate fan-out belongs to a later phase.
