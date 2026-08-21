# @flinter/dsh-segment

English | [中文](README.zh.md)

**S0 prototype / reference skeleton** — NOT a production scientific
implementation. This is the first milestone of the FLINTER segment plugin for
DeepSeek Harness: it exists to prove the container boot → tool call → artifact
write path with deterministic stubs, and to freeze the tool-name/schema contract
that later milestones implement behind.

The plugin is a bundle (`dsh.bundle.patch` → `cordis.patch.yml`) that the
headless profile discovers and mounts as one row beside its other bundles.
No TowerH/TowerT, VLM, DINOv2, Foote, CoTracker, B2, session persistence,
retries, or control-plane wiring is present in this milestone — those are later
tracks, not S0.

## Scope: S0 (what this skeleton proves)

- The package loads from a clean checkout (a dedicated worktree).
- The headless profile discovers the plugin through `cordis.patch.yml`.
- All five prototype tools register and accept valid input:
  | Tool | Input | Deterministic stub output |
  |---|---|---|
  | `frames.sample` | `window`, optional `budget` | fixed frame list + artifact descriptor |
  | `track.cotracker` | `window`, `seeds[]` | fixed track descriptor |
  | `boundary.detect` | `track_ref` | fixed candidate list |
  | `vlm.ask` | `frames_ref`, `question` | fixed canned answer |
  | `artifact.write` | `name`, `data`, optional `out_dir` | writes the payload to disk |
- Every tool returns a schema-valid deterministic stub result with a SHA-256
  content hash of its own artifact payload (`artifact` + `content_hash`).
- The worker boot / tool-call path is smoke-tested **keyless** — no TowerH,
  TowerT, VLM, B2, or live provider is contacted by the tests.

## Not in S0 (later milestone / CP tracks)

- Real CoTracker / VLM / DINOv2 / Foote / TowerH integration.
- `InvestigationRun` / `dshSessionId` persistence, Postgres, leases/fencing,
  retries, Fargate launch or callbacks, shared session roots / checkpoints,
  cross-Fargate resume, B2 writes, session-log shipping.
- Semantic capability registry or renaming the prototype tools (separate task).
- Merging this branch into `flinter/aws-runtime` or `flinter/dsh-segment`.

## Loading and tests

The headless profile stacks bundles in `dsh.profile.bundles` order; adding
`@flinter/dsh-segment` to that list (as the worker image does) mounts the
plugin through `cordis.patch.yml`. In this repository the composition is
verified against the real bundle patches by `tests/loader.spec.ts` and the
plugin is booted end-to-end by `tests/keyless-smoke.e2e.ts`.

```sh
# From the worktree, after pnpm install:
pnpm exec vitest run examples/dsh-segment/tests/loader.spec.ts
pnpm exec vitest run --config vitest.e2e.config.ts examples/dsh-segment/tests/keyless-smoke.e2e.ts
```

## Next steps (not S0)

- Wire real samplers/trackers/detectors behind the frozen schemas.
- Replace `artifact.write` stub with B2 capability-URL write.
- Add `ctx.userQuestions` adapter for Trigger.dev waitpoints.
- Add session-log shipping to B2 at teardown.
