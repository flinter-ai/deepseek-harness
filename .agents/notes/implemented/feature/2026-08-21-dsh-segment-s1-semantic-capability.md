# Agent Note: dsh-segment S1 semantic capability

Status: implemented

English | [中文](2026-08-21-dsh-segment-s1-semantic-capability.zh.md)

## Problem

The S0 prototype ([2026-08-21-dsh-segment-s0-prototype-skeleton](2026-08-21-dsh-segment-s0-prototype-skeleton.md)) froze the plugin with five registered prototype tools (`frames.sample`, `track.cotracker`, `boundary.detect`, `vlm.ask`, `artifact.write`) as the public surface. That surface is the exact trap the control-plane lane must avoid: an orchestrator (aws-runtime) could call a prototype primitive directly, mistake a deterministic stub for production physics output, or rely on a tool that later milestones will rename. The production direction names semantic capabilities (`RUN_BASELINE_PHYSICS`, `INSPECT_TRACE_GAP`, …) as the public interface, with the prototype primitives as implementation detail behind a capability registry.

## Decision

Ship the S1 semantic-capability layer on branch `feat/dsh-segment-s1` (base `bca4a955`, the frozen S0 HEAD):

- `examples/dsh-segment/index.js` registers exactly ONE tool, `RUN_BASELINE_PHYSICS` — the sole registered semantic capability. The five S0 primitives become plain internal functions (`sampleFrames`, `trackWindow`, `detectBoundaries`, `askVlm`, `writeArtifact`) under `tools/`; none is registered, so no primitive is externally callable and no phantom capability name is advertised.
- A minimal capability registry (`capabilities/registry.js`) maps id → adapter, lists only registered ids, fails loud on unknown ids, and returns a disposer from `register()`. The tool's `execute` dispatches through it.
- `capabilities/run-baseline-physics.js` owns the typed request/result schemas and the adapter. The adapter resolves defaults explicitly (`request.out_dir ?? config.out_dir ?? default`), chains `sampleFrames → trackWindow → detectBoundaries → writeArtifact`, and wraps the deterministic stub artifact in a typed envelope carrying `capability_id`, `schema_version`, `status`, `abstention: 'prototype_stub'`, provenance (each internal stage's content hash), the artifact ref, and an envelope `content_hash` over the canonical JSON of every other field. The on-disk artifact bytes hash to the artifact ref's `content_hash`.
- Abstention is a hard marker, not an accident: a stub result can never be consumed as measured physics output (MISS stays MISS). `askVlm` remains an internal primitive that no S1 capability reaches yet.
- Tests: `tests/contract.spec.ts` is new — it simulates an aws-runtime-style caller that boots the real Loader composition and drives ONLY the semantic surface, asserting the typed result, provenance, abstention marker, and content-hash consistency (envelope hash, stage hash, and on-disk bytes). `tests/keyless-smoke.e2e.ts` and its driver assert the new registration shape (exactly `[RUN_BASELINE_PHYSICS]`), determinism, and the artifact-write path in both src and built-`lib/` modes. `tests/loader.spec.ts` keeps proving bundle discovery.
- `README.md` / `README.zh.md` describe S1: one semantic capability, internal prototype primitives, abstention semantics. `package.json` `files` gains `capabilities/` so a packed consumer resolves the entry imports.

S1 does not add `InvestigationRun`/`dshSessionId` persistence, Postgres stores, leases/fencing/retries, Fargate launch or callbacks, shared session roots/checkpoints/resume, B2 writes, real CoTracker/VLM/DINOv2/Foote/TowerH/TowerT integration, or further semantic capabilities. It changes nothing in `flinter/aws-runtime`, `flinter/dsh-segment`, `deploy/dsh-worker/DSH_COMMIT`, or `~/.dsh` credentials/settings.

## Alternatives considered

**Expose the semantic capability as a Cordis service beside the tools surface.** Rejected: the plugin's only invocation seam is the tools executor, and the future aws-runtime orchestrator will drive the capability the same way the contract test does; a parallel service would duplicate schema validation and execution machinery for one caller.

**Keep the five prototype tools registered alongside the semantic capability.** Rejected: they would still look callable, and a stub primitive remains a prototype trap regardless of how prominently the capability is advertised.

**Register a rolled-up capability list including future ids (`INSPECT_TRACE_GAP`, …).** Rejected per the no-phantom-list rule: the registry must register only what is implemented, and `list()` answers exactly the registered ids.

**Internally chain on `defineTool`-wrapped factories instead of plain functions.** Rejected: the primitives no longer need tool-registry validation or presentation, and the adapter's direct calls are deterministic pure functions of their arguments.

## Consequences

The public surface is now one semantic capability, so both the S0 loader/keyless smokes changed shape (adjusted, not dropped) and the five primitive names are no longer externally callable. The envelope `content_hash` is deterministic across runs because machine-specific state (the artifact path) is excluded from hashing; the artifact ref records name + hash, and callers derive the path from `out_dir`. `askVlm` stays as the frozen internal primitive for later state-verification capabilities. The S0 note's future-task sentence is superseded by this note, which the S0 note now cross-links. The integration merge gate still stands: only after this semantic checkpoint may an integration branch combine the DSH line with `aws-runtime`, at which point `DSH_COMMIT` may be updated — that integration remains future work.