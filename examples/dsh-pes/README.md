# @flinter/dsh-pes

English | [中文](README.zh.md)

**Searchable-trace plugin** for DeepSeek Harness: four native agent-facing
tools over the searchable-trace event index —

| Tool | Engine mode | Ask |
|---|---|---|
| `search_events` | `search` | natural-language query over all indexed events |
| `find_similar_states` | `similar` | events whose pre-state matches a physical state |
| `find_counterfactuals` | `counterfactual` | state-similar episodes with a DIFFERENT outcome |
| `zoom` | `zoom` | all events of one episode overlapping a frame window |

The engine is the `event_index.query` JSON-lines CLI from the producer slice
([flinter-ai/flinter-common `feat/searchable-trace-engine`](https://github.com/flinter-ai/flinter-common),
immutable SHA `c05c3fc747f0aa0fcb9d0603009add71c59e091b`). This plugin NEVER
imports the engine package or any sibling checkout at runtime: it spawns the
CLI through an **explicit configured command seam** and speaks the documented
stdin JSONL protocol (one request object per line → one response object per
line). The plugin is a bundle (`dsh.bundle.patch` → `cordis.patch.yml`) that
the headless profile discovers and mounts as one row beside its other bundles.

## Scope (what this plugin proves)

- Four registered tools with stable, bounded schemas: result `n` is clamped
  to `MAX_RESULT_N` (50) and to the corpus; state arrays, text fields, and
  engine stdout/stderr are all bounded.
- An explicit engine seam: `config.command` (argv, mode-less) — else
  `$PES_QUERY_COMMAND` (JSON array) — else the packaged default
  `['python3', '-m', 'event_index.query']`. The events index comes from
  `config.events`, else `$PES_EVENTS_ENRICHED_JSONL`; it is passed explicitly
  as `--events PATH` on every invocation and never guessed from cwd.
- Structured results that **preserve the engine's failure surface** instead of
  hiding it: every result is a bounded envelope with `provenance` (plugin +
  engine protocol + optional immutable `engine_pin`) and per-event provenance
  (`provenance` / `verification` / `outcome_source`) passed through unchanged.
  Honest abstention (`abstained: true` from the engine) maps to
  `status: 'abstained'`, never an error. Engine failures map to a stable
  `error.kind`:

  | kind | meaning |
  |---|---|
  | `malformed-input` | schema-valid but semantically invalid arguments (plugin), or engine-reported per-request rejection |
  | `engine-timeout` | the configured subprocess deadline elapsed |
  | `engine-nonzero-exit` | engine exited nonzero without a parseable error response (stderr preserved) |
  | `engine-malformed-response` | stdout violates the one-request/one-response protocol |
  | `engine-unavailable` | the command could not be started, or no events index is configured |
  | `artifact-reference-missing` | a returned event's `source_path` does not resolve under `config.artifactsRoot` (fail-closed) |

- Artifact references: when `config.artifactsRoot` (else `$PES_ARTIFACTS_ROOT`)
  is set, every returned event's `source_path` must resolve to an existing
  file under that root; a missing reference fails the whole call loud.
  `artifact_verification` reports `verified` / `unconfigured`.
- Keyless worker boot → Loader → tools surface → engine command seam path:
  no engine package, no live provider, no network is contacted by the tests
  (the fixture stub re-implements the documented protocol).

## Engine seam (read before wiring a deployment)

```js
// config.command is the full argv WITHOUT --events and WITHOUT a mode;
// the plugin appends --events <resolved-path> itself.
config: {
  command: ['python3', '-m', 'event_index.query'],
  events: '/data/events.enriched.jsonl',       // else $PES_EVENTS_ENRICHED_JSONL
  timeout_ms: 30_000,                           // validated int in [1, 120_000]
  artifacts_root: '/data/artifacts',            // optional artifact root
  engine_pin: 'c05c3fc747f0aa0fcb9d0603009add71c59e091b', // optional producer pin
}
```

## Integration gates (NOT_RUN — not completed by this PR)

- **Runtime engine packaging**: making `python3 -m event_index.query`
  importable at deploy time (wheel/image layer with the `event_index` package
  and its data files) is deployment work, not this plugin's PR. Until then an
  unimportable engine surfaces as a structured `engine-nonzero-exit` /
  `engine-unavailable` result — never a silent empty answer.
- **Immutable producer pin**: the engine's producer SHA
  `c05c3fc747f0aa0fcb9d0603009add71c59e091b` is recorded here as provenance
  documentation; deployments pin it via `config.engine_pin`, which flows into
  every result's `provenance.engine_pin`. Pinning is exercised by packaging,
  not by this PR.
- **Real backends**: real TowerH scans, real outcome labels, RDS
  `005_experience_events`, Octen embeddings, and any AWS/provider resource
  remain NOT_RUN (see the producer roadmap).
- **Integration status (branch `integration/aws-runtime-on-s1`)**: this plugin
  and dsh-segment S0+S1 are merged into the AWS runtime line, the aws-headless
  profile mounts both bundles, and the profile pins
  `config.engine_pin` to the producer SHA above. `DSH_COMMIT`, control-plane
  code, and credentials remain unchanged; the standalone PR itself did not
  merge into `flinter/aws-runtime`.

## Loading and tests

The headless profile stacks bundles in `dsh.profile.bundles` order; adding
`@flinter/dsh-pes` to that list mounts the plugin through
`cordis.patch.yml`. In this repository the composition is verified against
the real bundle patches by `tests/loader.spec.ts`, the engine seam and the
structured-error taxonomy are pinned by `tests/seam.spec.ts`, the structured
result contract is pinned by `tests/contract.spec.ts`, and the plugin is
booted end-to-end by `tests/keyless-smoke.e2e.ts`.

```sh
# From the worktree, after pnpm install:
pnpm exec vitest run examples/dsh-pes/tests/loader.spec.ts examples/dsh-pes/tests/seam.spec.ts examples/dsh-pes/tests/contract.spec.ts
pnpm exec vitest run --config vitest.e2e.config.ts examples/dsh-pes/tests/keyless-smoke.e2e.ts
# The same suites against built lib/ (as CI runs them):
DSH_EXAMPLE_MODE=lib pnpm exec vitest run examples/dsh-pes/tests/loader.spec.ts examples/dsh-pes/tests/seam.spec.ts examples/dsh-pes/tests/contract.spec.ts
DSH_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.e2e.config.ts examples/dsh-pes/tests/keyless-smoke.e2e.ts
```

## Design invariants (read before changing)

- The engine is reachable ONLY through the configured command seam
  (`engine.js`): never import `event_index`, a sibling checkout, or a mutable
  branch at runtime.
- Results are always the bounded structured envelope — a completed call may
  still be `abstained`; every engine failure becomes a structured `error`
  result, never a thrown error or an empty-but-successful answer.
- Bounds live in the plugin (`query.js`), not only in schemas: the supported
  schema subset has no numeric/string length keywords, so `n`, state-array
  sizes, and text lengths are semantically validated before any spawn.
- Misconfiguration fails loud at load (`config.command`, `timeout_ms`) or as
  `engine-unavailable` at call time (missing events index) — never silently.
- Only implemented tools are registered: exactly the four names above; no
  phantom surface.
