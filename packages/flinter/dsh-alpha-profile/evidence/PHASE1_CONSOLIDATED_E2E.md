# Phase 1 consolidated E2E evidence

Status: **PASS for the local and mock-provider scope**. This record is public
and contains no credential values, AWS account data, or live-provider output.

## Scope

This gate proves the DSH alpha harness and its connection seams to current
FLINTER code. It does not claim live AWS, paid-provider, Tower, Beam, or
control-plane deployment evidence.

| Item | Result | Evidence |
| --- | --- | --- |
| Pinned substrate | PASS | `dsh-v0.1.2-alpha.1` at `cd5ef8148158c3a752a658978873241fdf8e2bbc` |
| Candidate line | PASS | `feat/dsh-phase2-composition-wiring` at the Phase 1 gate commit |
| Isolated `DSH_HOME` | PASS | Source-checkout CLI process E2E creates and removes temporary homes |
| Local `tod` profile | PASS | Real alpha loader boots base/headless bundles with local credentials |
| AWS worker profile loader | PASS | Real source-checkout loader boots with a mocked Secrets Manager |
| Credential mapping | PASS | Request-time resolution and `describe()` return source metadata only |
| Direct DeepSeek route | PASS | Mock OpenAI-compatible endpoint receives the direct route/model |
| ARK / Modelflare routes | PASS | Mock endpoints validate route selection and credential references |
| GMI explicit route | PASS | Mock endpoint validates explicit-only GMI selection |
| Context capacity | PASS | Model-level `contextWindow: 1000000` is resolved and persisted in request context |
| Reasoning selection | PASS | User-selected values are preserved; the profile advertises verified `high` support |
| UTC rotation | PASS | `tod` selects Modelflare outside 16:00–24:00 UTC and ARK inside the window |
| Existing-session retention | PASS | Worker replacement resumes the same DSH session/root while changing attempt identity |
| Native event consumer | PASS | Session, turn/request/message/end records are consumed losslessly, including opaque events |
| Secret leakage | PASS | Process output, settings metadata, and evidence contain no credential values |
| Temporary-unavailability retry | PASS | Availability wording maps to retryable `SERVER`; 74 conversion tests pass |
| Agent Teams | NOT RUN | Source/profile remains experimental; no Orca replacement claim |
| Real AWS/provider calls | NOT RUN | Deliberately outside Phase 1 local/mock gate |

## Commands and results

Run with the repository-declared compatible Node runtime (Node 22.23.2 in this
environment; Node 24 is also supported by the repository declaration):

```text
pnpm exec vitest run --config vitest.e2e.config.ts \
  packages/flinter/dsh-alpha-profile/tests/harness.e2e.ts \
  packages/flinter/dsh-alpha-profile/tests/worker-driver.e2e.ts \
  packages/flinter/dsh-alpha-profile/tests/process.e2e.ts \
  packages/flinter/dsh-alpha-profile/tests/aws-profile-loader.e2e.ts
→ 4 files, 6 tests passed

pnpm exec vitest run packages/llm/llm-pi-ai/tests/convert.spec.ts
→ 74 tests passed

pnpm run build:lib:host
→ passed

pnpm run typecheck
→ passed

pnpm run verify-config-catalog
→ passed

pnpm run verify-translation-pairing
→ 1081 pairs passed
```

The AWS test replaces the Secrets Manager client only inside the child
process. It validates the actual profile-loader path without reading or
writing real AWS state. The local process test uses mock HTTP providers and
the source-checkout CLI, so it validates process/session behavior rather than
only an in-process fixture.

## Gate decision

Phase 1 is locally accepted for the harness, profile, credential, native-event,
and compatibility scope. The next implementation gate is the public
`trace-link` package. Phase 2 must not be treated as complete until each later
package has its own component test, deterministic local E2E, and compatibility
evidence. No production cutover, Orca deprecation, AWS deployment, Beam
integration, or cleanup is authorized by this local result.
