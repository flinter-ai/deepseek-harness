# Trace-link local compatibility evidence

Status: **PASS for the metadata-only local seam**.

This package consumes the native DSH event projection from
`@deepseek-ai/dsh-alpha-profile` and emits the existing FLINTER
`flinter.trace-link.v1` shape. The adapter carries only organization, session,
sequence, execution, link, and producer-provenance fields.

The existing FLINTER contract remains authoritative in
`flinter-data-infra/src/investigation/trace-link-v1.mjs` and
`schemas/trace-link-v1.schema.json`. This DSH package does not copy that
repository, change its schema, or interpret its events. It is a public bridge
over the contract so downstream consumers can depend on the same wire shape.

## Verified

- native `turn/start` and opaque/plugin events can be referenced by sequence;
- event payload and model/tool data do not enter the link;
- cross-session references fail closed;
- unknown fields on an already-projected reference fail closed;
- identifiers, non-negative sequence values, and version tokens are validated;
- package component tests and TypeScript build pass;
- no provider, AWS, storage, Tower, Beam, or control-plane state is accessed.

## Commands

```text
pnpm exec vitest run packages/flinter/dsh-trace-link/tests/index.spec.ts
→ 3 tests passed

pnpm --filter @deepseek-ai/dsh-trace-link build
→ passed
```

This is not yet full trace-link parity evidence. A deterministic downstream
E2E and comparison against the current data-infra consumer remain required
before the package is accepted as the Phase 2 trace-link gate.
