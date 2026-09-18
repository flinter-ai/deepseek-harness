---
description: "Host-only, redacted activity state for a deployment-owned idle-stop controller; it never decides or performs a machine shutdown."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-idle-guard

English | [中文](README.zh.md)

## Summary

Write a redacted activity snapshot for a deployment-owned idle-stop policy. The snapshot records recent Web activity, active execution counters, and whether the composition is complete enough to evaluate. Choose it for an EC2 host that needs a conservative 30-minute idle signal; this plugin never stops the machine.

The plugin never reads or writes credentials, request bodies, session content, or provider state. It does not call AWS, stop an instance, or expose a shutdown endpoint. Missing or stale state must be treated as “do not stop” by the deployment controller.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose `@deepseek-ai/dsh-host-idle-guard` after `webServer`, with `enabled: true` and an operator-owned absolute `stateFile`. It discovers the optional `jobs` and `terminals` services on each refresh. Set `ptyMode: absent` only when the composition explicitly has no PTY service, as the shipped Web bundle does; otherwise the default `required` mode treats a missing terminal counter as unsafe. The writer refreshes every 30 seconds by default and replaces the file atomically. If a required execution counter is unavailable, it records `capabilitiesReady: false`; the deployment controller must then keep the host running. Otherwise the controller should take a shared deployment lock, re-read the state, verify that all four counters are zero and the timestamp is at least 30 minutes old, then stop the host only when its own service policy allows it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin observes Web activity and optional process registries through Cordis reflection. It writes schema-versioned state atomically and never owns the stop decision. The deployment script separately checks service state, freshness, counters, and a shared lock before invoking the machine lifecycle boundary.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Host Web server](../webserver/README.md) — request and WebSocket activity source.
- [EC2 deployment](../../../deploy/dsh-ec2/README.md) — idle-stop policy and systemd units.
- [Configuration catalog](../../../docs/config-catalog.md) — generated package metadata.

-----

## Model Experience

### Host lifecycle policy

#### What the model sees

Nothing directly. This host service exposes no model-facing tool, prompt, message, or user-content field; `dsh-host-idle-guard` publishes only redacted process facts to the deployment controller.

#### Token effect

None. The activity snapshot is not added to provider requests or model context.

#### KV Cache effect

None. Updating the local lifecycle snapshot does not change a model request prefix.

## Known Limitations and Deferred Work

No runtime invariant companion is published because this package owns only a redacted snapshot writer; the external deployment controller and systemd lifecycle are the owners of the shutdown decision.

- Activity is intentionally conservative: any active request, WebSocket, job, or PTY prevents an idle stop.
- The state file is local operational evidence, not durable session storage.
- The plugin does not itself own an EC2 power operation; deployment units own that irreversible boundary and must fail closed on missing or stale state.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
