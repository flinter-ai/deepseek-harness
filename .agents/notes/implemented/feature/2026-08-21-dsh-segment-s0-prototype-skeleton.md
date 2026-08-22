# Agent Note: dsh-segment S0 prototype skeleton

Status: implemented

English | [中文](2026-08-21-dsh-segment-s0-prototype-skeleton.zh.md)

## Problem

The `examples/dsh-segment` plugin lived as a half-built skeleton: its `cordis.patch.yml` was comment-only, so no headless profile could load the plugin; the entrypoint and the five prototype tools had no registration, no pinning tests, and no deterministic stub artifact with a content hash. Without a provable, frozen checkpoint, the plugin's prototype primitives could be mistaken for a production interface — the exact trap the control-plane lane must avoid (charter §3A): loader or image smoke passing on an S0 prototype must not authorize a merge into `aws-runtime` or count as production completion.

## Decision

Ship an S0 prototype/reference skeleton of the `dsh-segment` plugin on branch `feat/dsh-segment-s0` (base `flinter/dsh-segment` @ `20ec9d16`, final SHA `287548eb`):

- `cordis.patch.yml` now inserts a real bundle patch registering `id: dsh-segment, name: '@flinter/dsh-segment'`, so a headless profile discovers and loads the plugin.
- `index.js` entrypoint injects only `['tools']` — the plugin never uses `jobs`, so an unused inject would hold activation hostage to an unrelated service.
- `examples/package.json` declares the `@flinter/dsh-segment` link dependency, required both for runtime resolution and by `verify-cordis-config`'s reference check.
- The five prototype tools (`frames.sample`, `track.cotracker`, `boundary.detect`, `vlm.ask`, `artifact.write`) keep their stable schemas unchanged; new tests pin them. Deterministic stub artifacts carry sha256 `content_hash` values that match the written bytes.
- `tests/loader.spec.ts` proves headless-profile discovery via composition; `tests/keyless-smoke.e2e.ts` proves a keyless real-loader boot in both source and built-`lib/` modes.
- `README.md` states explicitly this is an S0 prototype/reference skeleton with no production scientific capability claim.

S0 does not include `InvestigationRun`/`dshSessionId` persistence, Postgres stores, leases/fencing/retries, Fargate launch or callbacks, shared session roots/checkpoints/resume, live providers (B2, TowerH, TowerT, VLM, CoTracker), or a semantic capability registry. It changes nothing in `flinter/aws-runtime`, `flinter/local-harness`, `flinter-data-infra`, `deploy/dsh-worker/DSH_COMMIT`, or `~/.dsh` credentials/settings.

## Alternatives considered

**A bare-name import facade for plain-`.js` specs.** Rejected after the harness tsconfig path facade proved not to apply to plain `.js` modules under `examples/`; the repository convention is the passing sibling-spec import style, which the shipped tests mirror.

**Injecting `['tools', 'jobs']`.** Rejected because the plugin never uses `jobs`; an unused inject would hold plugin activation hostage to a jobs service.

**Merging `dsh-segment` into `aws-runtime` once loader/image smoke passes.** Rejected per charter §3A: the exposed surface is still prototype primitives, and the merge gate is the semantic capability contract (S1), not smoke evidence.

## Consequences

S0 is a frozen prototype checkpoint: nothing in it claims production scientific capability, and its worker-image smoke is external integration evidence only. The next separate DSH task is a semantic capability adapter plus a minimal capability registry and contract tests; only after that semantic checkpoint may an integration branch combine the DSH line with `aws-runtime` and its AWS extras, at which point `DSH_COMMIT` may be updated. This note must be kept current with the shipped S0 facts (paths, schemas, mechanisms) in the same change that alters them.