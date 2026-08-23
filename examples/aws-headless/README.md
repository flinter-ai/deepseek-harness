# aws-headless

English | [中文](README.zh.md)

Keyless runtime composition for the AWS deployment line: `dsh-base` plus the
dsh-orca worker bridge, the dsh-segment semantic surface
(`RUN_BASELINE_PHYSICS`), and the dsh-pes searchable-trace tools, with the
credentials store swapped for AWS Secrets Manager and the catalog Bedrock
route of the dormant pi-ai adapter registered. Boots and runs with ZERO AWS
calls: both AWS providers defer to the default credential chain per request,
never at boot.

## Profile

- `profile/package.json` — `dsh.profile.bundles` lists the four bundles in
  order (`@deepseek-ai/dsh-base`, `@flinter/dsh-orca`,
  `@flinter/dsh-segment`, `@flinter/dsh-pes`).
- `profile/cordis.patch.yml` — disables the local credential store before the
  AWS Secrets Manager row mounts, registers the Bedrock route with an empty
  `providers.amazon-bedrock` config, and pins the dsh-pes engine to the
  immutable producer SHA `c05c3fc747f0aa0fcb9d0603009add71c59e091b` so every
  tool result carries the pin in `provenance.engine_pin`.

The keyless gates (`tests/aws-headless.e2e.ts`, `tests/aws-headless.snapshot.ts`,
`tests/agentic-trajectory.e2e.ts`) boot and snapshot this composition with the
AWS environment stripped and the engine seam filled by a protocol-compatible
stub.

## Runtime semantic/trace E2E driver

`runtime-driver.js` is the reusable runtime task the cloud worker invokes
against the REAL assembled profile (never a shrunken fixture configuration).
It drives exactly two tools, makes no LLM/model decision, and emits exactly
one bounded machine-readable JSON summary on stdout:

- `RUN_BASELINE_PHYSICS` as an **interface check only**: the driver requires
  the honest `abstention: 'prototype_stub'` marker and reports the result as a
  stub-interface check. It is never presented as scientific TowerH success.
- `search_events` with deterministic arguments from `$PES_TRACE_TASK_ARGS`
  (`["--query", "...", "--n", "..."]`, else the packaged defaults) against the runtime corpus (`$PES_EVENTS_ENRICHED_JSONL`)
  and the runtime engine (`$PES_QUERY_COMMAND`, else
  `python3 -m event_index.query`). The driver requires `status: completed`,
  `abstained: false`, bounded results (`count` in `[1, requested_n]` with
  consistent arrays), the pinned producer engine
  `c05c3fc747f0aa0fcb9d0603009add71c59e091b` in `provenance.engine_pin`, and,
  when `$PES_TRACE_*` transport is configured, an `accepted` automatic trace
  emission for the completed result.

Production mode NEVER falls back to a test fixture engine: the engine seam
resolves to `$PES_QUERY_COMMAND` or the packaged default command only, and an
unusable engine surfaces as a structured `engine-*` failure that fails the
run. This is a runtime semantic/trace E2E — not scientific TowerH proof — and
the summary states so (`"scientific_proof": false`).

### Entrypoint (the invocation the data-infra runtime supplies)

```sh
node --import tsx/esm examples/aws-headless/runtime-driver.js
```

`PES_TRACE_AWS_PROFILE` selects the profile and defaults to `aws-headless`. The runtime must supply:

| variable | meaning |
|---|---|
| `DSH_HOME` | a home whose `profiles/aws-headless` is the materialized assembled profile |
| `PES_EVENTS_ENRICHED_JSONL` | the events index the engine reads as `--events` (required) |
| `PES_QUERY_COMMAND` | engine argv as a JSON array; omit for `python3 -m event_index.query` |
| `PES_TRACE_TASK_ARGS` | JSON string array accepting `--query` and `--n` once each; defaults to `cup acquisition` and `3` |
| `PES_TRACE_AWS_PROFILE` | assembled profile name (default `aws-headless`) |
| `PES_ARTIFACTS_ROOT` | optional artifact root for `source_path` verification |
| `PES_TRACE_*` | optional trace transport + ancestry; when configured, emission must be `accepted` |

### Exit codes

| code | meaning |
|---|---|
| 0 | pass |
| 1 | boot/composition or unexpected drive failure |
| 2 | missing corpus (`$PES_EVENTS_ENRICHED_JSONL` unset or absent) |
| 3 | engine unavailable or engine failure (`engine-*` structured result) |
| 4 | search abstention |
| 5 | malformed provenance (missing/mismatched `engine_pin` or envelope fields) |
| 6 | trace transport failure (configured but not `accepted`) |
| 7 | `RUN_BASELINE_PHYSICS` interface check failed |

## Keyless process test

`tests/runtime-driver.e2e.ts` runs the driver as a subprocess against the real
aws-headless Loader with a localhost callback receiver and a deterministic
engine command, asserting the one-line summary and the automatic emission end
to end (exact body, `x-webhook-signature` HMAC header, pinned producer SHA,
deterministic record id), then pins every nonzero exit class with dedicated
fixtures (a failing engine, an abstaining engine, an unpinned profile, a 500
receiver).
