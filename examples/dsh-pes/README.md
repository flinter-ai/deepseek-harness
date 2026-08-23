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
- Runtime-owned automatic emission: after every COMPLETED (non-abstained)
  result the plugin maps the result/provenance into the committed CP
  searchable-trace wire record and POSTs the exact signed bytes to the
  runtime-configured callback URL — a producer side effect, never a tool.

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

## Runtime-owned searchable-trace emitter (read before changing)

The plugin is also an automatic producer for the committed CP searchable-trace
projection (`trace.js` + `trace-record.js`): after a completed (non-abstained)
dsh-pes result it deterministically maps the result and its provenance into
the CP wire record and POSTs the exact bytes to the runtime-configured
callback URL. It is explicitly NOT a tool, registers nothing model-visible,
and can never select or observe its own destination.

- **Wire record (`trace-record.js`, pure seam).** Canonical key order
  `organizationId, projectId, episodeId, jobId, irId, jobOutputId, artifactId,
  runOrdinal, traceKind, summaryText, producerSha, schemaVersion, id`, compact
  JSON. `traceKind` is the invoked tool name; `summaryText` is a bounded
  (≤ 2000 chars) deterministic projection; `producerSha` is
  `config.engine_pin`, else the committed engine commit `c05c3fc…` (always
  the ENGINE commit, never the AWS runtime revision); `id` is
  `tr_<sha256(organizationId:irId:runOrdinal)>`'s first 24 hex chars, matching
  the committed CP derivation so CP replay is idempotent.
- **Transport ownership.** Callback URL and HMAC secret arrive ONLY through
  validated plugin config or the `PES_TRACE_*` environment — never through
  tool/model request fields. Setting exactly one of URL/secret, or enabling
  transport without the ancestry fields, fails loud at load; absent both keeps
  the emitter disabled.
- **Signature.** HMAC-SHA256 over the exact JSON body bytes, header
  `x-dsh-signature` lowercase hex (the convention selected by the T1 CP
  producer seam). The serializer/signer are pure functions, so T1/T2 byte
  equivalence is testable without importing control-plane packages or sibling
  repositories.
- **Honest semantics.** Emission is at-most-once per distinct completed result
  in-process (an identical repeat reports `duplicate` and never re-POSTs), and
  abstained/error results never emit — the committed trace contract defines no
  traceKind for them. Transport failures are classified — accepted (2xx),
  validation-rejected (400), unauthorized (401), conflict (409), rejected
  (other 4xx), unavailable (5xx/503), unreachable (network), unexpected — and
  never alter or fail the scientific result. Secrets and signatures are never
  printed or persisted.

| config | env | default | meaning |
|---|---|---|---|
| `trace_callback_url` | `PES_TRACE_CALLBACK_URL` | — | callback URL (http/https only) |
| `trace_hmac_secret` | `PES_TRACE_HMAC_SECRET` | — | HMAC secret (never printed/persisted) |
| `trace_organization_id` | `PES_TRACE_ORGANIZATION_ID` | — | ancestry: organization |
| `trace_project_id` | `PES_TRACE_PROJECT_ID` | — | ancestry: project |
| `trace_episode_id` | `PES_TRACE_EPISODE_ID` | — | ancestry: episode |
| `trace_job_id` | `PES_TRACE_JOB_ID` | — | ancestry: job |
| `trace_ir_id` | `PES_TRACE_IR_ID` | — | ancestry: investigation run |
| `trace_job_output_id` | `PES_TRACE_JOB_OUTPUT_ID` | — | ancestry: job output (result authority) |
| `trace_artifact_id` | `PES_TRACE_ARTIFACT_ID` | — | ancestry: artifact holding the full payload |
| `trace_run_ordinal_base` | `PES_TRACE_RUN_ORDINAL_BASE` | `0` | first emitted run ordinal |
| `trace_post_timeout_ms` | `PES_TRACE_POST_TIMEOUT_MS` | `10000` | POST deadline (validated int in [1, 60000]) |

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
- **AWS-headless composition**: the aws-headless profile mounts this plugin
  beside dsh-segment S0+S1 and pins `config.engine_pin` to the producer SHA
  above. `DSH_COMMIT`, control-plane code, and credentials remain separate
  from the plugin composition.
- **Real CP route**: posting to the actual `/webhooks/dsh-worker/trace` route
  (the T1 producer seam), real Postgres FK ancestry, and any cloud resource
  remain NOT_RUN in this plugin's tests; the emitter's localhost receiver and
  classified statuses are local evidence only. This composition does not
  update `DSH_COMMIT`, control-plane code, or credentials.

## Loading and tests

The headless profile stacks bundles in `dsh.profile.bundles` order; adding
`@flinter/dsh-pes` to that list mounts the plugin through
`cordis.patch.yml`. In this repository the composition is verified against
the real bundle patches by `tests/loader.spec.ts`, the engine seam and the
structured-error taxonomy are pinned by `tests/seam.spec.ts`, the structured
result contract is pinned by `tests/contract.spec.ts`, and the plugin is
booted end-to-end by `tests/keyless-smoke.e2e.ts`. The runtime-owned emitter —
canonical bytes/signature, transport ownership, at-most-once duplicate/retry,
400/401/409/503 classification, and no emission for abstained/error results —
is pinned by `tests/trace.spec.ts`; the contract and smoke drivers also boot
a localhost receiver and assert the automatic emission end to end (one record
per distinct completed result, exact body + HMAC).

```sh
# From the worktree, after pnpm install:
pnpm exec vitest run examples/dsh-pes/tests/loader.spec.ts examples/dsh-pes/tests/seam.spec.ts examples/dsh-pes/tests/contract.spec.ts examples/dsh-pes/tests/trace.spec.ts
pnpm exec vitest run --config vitest.e2e.config.ts examples/dsh-pes/tests/keyless-smoke.e2e.ts
# The same suites against built lib/ (as CI runs them):
DSH_EXAMPLE_MODE=lib pnpm exec vitest run examples/dsh-pes/tests/loader.spec.ts examples/dsh-pes/tests/seam.spec.ts examples/dsh-pes/tests/contract.spec.ts examples/dsh-pes/tests/trace.spec.ts
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
- The trace emitter is runtime-owned: transport and ancestry come only from
  validated config or `PES_TRACE_*` environment; emission never alters or
  fails the tool result, emits only for completed results, and is at-most-once
  per distinct result in-process.
- Only implemented tools are registered: exactly the four names above; no
  phantom surface.
