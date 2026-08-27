# @flinter/dsh-segment

English | [中文](README.zh.md)

**S1 semantic-capability layer** — still a prototype/reference
implementation, not production scientific capability. S1 supersedes the S0
prototype tool surface with ONE registered semantic capability,
`RUN_BASELINE_PHYSICS`; the five S0 prototype primitives (`frames.sample`,
`track.cotracker`, `boundary.detect`, `vlm.ask`, `artifact.write`) are now
internal functions the capability adapter drives and no external tools.
Every result is explicitly abstained (`abstention: 'prototype_stub'`) and
carries provenance, so it can never be mistaken for real TowerH physics
output.

The plugin is a bundle (`dsh.bundle.patch` → `cordis.patch.yml`) that the
headless profile discovers and mounts as one row beside its other bundles.
No TowerH/TowerT, VLM, DINOv2, Foote, CoTracker, B2, session persistence,
retries, or control-plane wiring is present in this milestone.

## Scope: S1 (what this layer proves)

- A typed semantic request/result envelope: the input schema (`window`, and
  optional `budget`) and the output schema (provenance +
  abstention + `content_hash`) are enforced by the tools registry and pinned
  by tests.
- A minimal capability registry (id → adapter) with exactly one registered
  capability; unknown ids fail loud and no phantom capability name is
  advertised.
- Abstention semantics: every result carries `abstention: 'prototype_stub'`
  plus provenance listing each internal stage's content hash, so a stub can
  never be consumed as real physics output.
- Validated inputs, fail-closed: the request contract is exactly
  `{ window, budget }`; `budget` must be a positive integer (the schema
  rejects non-integers, the adapter rejects non-positive values BEFORE any
  stage runs), and any unknown request key — for example a model-supplied
  `out_dir` — is rejected rather than silently ignored, so the runtime-owned
  artifact path can never be steered from the model side.
- Real success/failure terminal behavior on the Loader surface: valid calls
  return the structured envelope; malformed calls, invalid-budget violations,
  unknown request keys, and unknown capability names all terminate as real
  `isError` tool results produced by the actual registered tool — no
  hand-crafted callback anywhere.
- Keyless worker boot → semantic capability → artifact write path: no
  TowerH, TowerT, VLM, B2, or live provider is contacted by the tests.
- Assembled loader proof: `tests/assembled-smoke.e2e.ts` composes the real
  bundle patch layers (`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless` +
  this bundle) exactly as the dsh profile launcher stacks them for the
  headless profile in the worker image, boots the composed tree through the
  actual Loader, and drives the semantic surface end to end.

The adapter chains the frozen S0 primitives `sampleFrames` → `trackWindow` →
`detectBoundaries` → `writeArtifact` and wraps the deterministic stub
artifact in the typed envelope:

| Surface | Role | Result |
|---|---|---|
| `RUN_BASELINE_PHYSICS` | the one registered semantic capability | typed envelope with provenance + `abstention` + `content_hash`; fail-closed `isError` on invalid/bounded/unknown requests |
| frames.sample, track.cotracker, boundary.detect, vlm.ask, artifact.write | internal functions, not registered as tools | staged stub artifacts with sha256 hashes |

## Not in S1 (later milestone / CP tracks)

- Real CoTracker / VLM / DINOv2 / Foote / TowerH integration.
- `InvestigationRun` / `dshSessionId` persistence, Postgres, leases/fencing,
  retries, Fargate launch or callbacks, shared session roots / checkpoints,
  cross-Fargate resume, B2 writes, session-log shipping.
- Further semantic capabilities (`INSPECT_TRACE_GAP` and the rest of the
  future list) — not registered; the registry registers only what is
  implemented.
- Directly merging this branch into `flinter/aws-runtime`, or updating
  `DSH_COMMIT` from this branch. (This S1 line itself lands on
  `flinter/dsh-segment` via a normal PR — that is the intended target, not a
  forbidden merge.)

## Loading and tests

The headless profile stacks bundles in `dsh.profile.bundles` order; adding
`@flinter/dsh-segment` to that list (as the worker image does) mounts the
plugin through `cordis.patch.yml`. In this repository the composition is
verified against the real bundle patches by `tests/loader.spec.ts`, the
semantic contract is pinned by `tests/contract.spec.ts`, the plugin is
booted end-to-end by `tests/keyless-smoke.e2e.ts`, and the ASSEMBLED headless
composition (base + headless + this bundle, the exact layers the worker image
mounts) is booted through the real Loader and driven by
`tests/assembled-smoke.e2e.ts`.

```sh
# From the worktree, after pnpm install:
pnpm exec vitest run examples/dsh-segment/tests/loader.spec.ts examples/dsh-segment/tests/contract.spec.ts
pnpm exec vitest run --config vitest.e2e.config.ts examples/dsh-segment/tests/keyless-smoke.e2e.ts examples/dsh-segment/tests/assembled-smoke.e2e.ts
# The same suites against built lib/ (as CI runs them):
DSH_EXAMPLE_MODE=lib pnpm exec vitest run examples/dsh-segment/tests/loader.spec.ts examples/dsh-segment/tests/contract.spec.ts
DSH_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.e2e.config.ts examples/dsh-segment/tests/keyless-smoke.e2e.ts examples/dsh-segment/tests/assembled-smoke.e2e.ts
```

## Next steps (not S1)

- Wire real samplers/trackers/detectors behind the capability adapter and
  replace the abstained stub with a real output envelope.
- Define a runtime-owned sampling/resource policy once window duration and
  real sampling semantics exist; derive and validate any maximum there before
  allocating frames instead of restoring a fixed model-visible budget cap.
- Register further semantic capabilities as their adapters land.
- Replace the `writeArtifact` stub with B2 capability-URL write.
- Add session-log shipping to B2 at teardown.

## Design invariants (read before changing)

- Register only implemented capabilities: the tool roster is exactly `[RUN_BASELINE_PHYSICS]`; never advertise a not-yet-implemented name.
- Prototype primitives are internal implementation: the five S0 tools (`frames.sample`, `track.cotracker`, `boundary.detect`, `vlm.ask`, `artifact.write`) are plain functions driven by the adapter, not a public surface.
- Stub results are always explicitly abstained: `abstention: 'prototype_stub'` plus provenance and `content_hash` — a stub can never be consumed as measured physics output.
- Requests fail closed at the semantic boundary: the adapter enforces exactly `{ window, budget }`, a non-empty string window, and a positive integer budget BEFORE any stage runs — a failing invocation writes no artifact and fabricates no provenance. Unknown request keys (including any model-supplied `out_dir`) are rejected, never silently ignored, so the artifact path stays plugin-config → runtime env → module default. No fixed maximum is claimed until a real sampler and runtime-owned resource policy establish one.
- Capabilities are model-visible TOOLS today: DSH owns investigation, and the control plane does not select scientific capability. Switch to an internal service seam only when a runtime must enforce baseline before the model starts — that is the S2/runtime-contract track, not this plugin's S1.
- Merge gate: an integration branch combining this line with `flinter/aws-runtime` (and then updating `DSH_COMMIT`) happens only after the semantic contract checkpoint.
