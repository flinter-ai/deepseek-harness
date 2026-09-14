---
description: "The flinter package group: FLINTER-owned profile overlays for provider selection, credentials, and AWS worker composition over DSH seams."
kind: "package-group"
---

# flinter/ — FLINTER DSH profile overlays

English | [中文](README.zh.md)

## Summary

The `flinter/` group contains FLINTER-owned overlays that compose provider profiles, credential references, compute selection, and AWS worker launch behavior over public DSH seams. Use these packages when a FLINTER host needs its route or worker policy; the DSH core owns the agent loop, session format, and provider adapters. The overlays do not create a second harness installation or store secret values.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The two packages separate general profile composition from the AWS worker credential overlay.

| Package | Role |
|---|---|
| [`dsh-alpha-profile/`](dsh-alpha-profile/README.md) | Composes FLINTER provider routes, compute selection, and DSH worker attempt policy |
| [`dsh-aws-worker-profile/`](dsh-aws-worker-profile/README.md) | Provides the read-only AWS credential-provider overlay for a worker host |

<a id="related-documentation"></a>
## Related documentation

- [Capability seams](../../docs/capability-seams.md) — the service boundaries these overlays consume.
- [Credentials subsystem](../../docs/subsystems/credentials.md) — the host-owned credential-reference contract.
- [Host package group](../host/README.md) — the runtime host packages that mount these overlays.

<a id="dev-note"></a>
## Dev Note

None.
