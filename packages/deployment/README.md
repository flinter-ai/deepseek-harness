---
description: "The deployment package group: private composition roots used to assemble immutable runtime artifacts for supported hosts."
kind: "package-group"
---

# deployment/ — runtime artifact packaging

English | [中文](README.zh.md)

## Summary

The `deployment/` group contains private composition roots used to assemble reproducible DSH runtime artifacts. Use these packages as build inputs for a host deployment; they are not alternate DSH application launchers. Host scripts, service units, IAM policy, and persistent state remain in `deploy/` and on the target host.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The group currently contains one private artifact composition root.

| Package | Role |
|---|---|
| [`dsh-ec2-runtime/`](dsh-ec2-runtime/README.md) | Pins the dependency closure staged into the immutable DSH Web EC2 runtime artifact |

<a id="related-documentation"></a>
## Related documentation

- [EC2 deployment process](../../deploy/dsh-ec2/README.md) — artifact build, verification, activation, and rollback boundaries.
- [Bundle group map](../bundle/README.md) — the upstream composition layer mounted by the artifact root.

<a id="dev-note"></a>
## Dev Note

None.
