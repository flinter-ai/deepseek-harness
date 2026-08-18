# dsh-tool-agentic-control

English | [中文](README.zh.md)

Model-facing bounded macro-actions over the [dsh-agentic-control](../agentic-control/README.md) investigation domain: `run_physical_assessment`, `finish_investigation`, and `stop_unknown`, plus the authoritative state projection injected before each agent step.

## Projection

A prepended `agent/pre-step` listener appends a source-attributed (`plugin: tool-agentic-control`, `form: snapshot`) rendering of the current investigation state whenever its durable revision changed. The loop logs entered messages as ordinary durable `user/message` events, so everything the model sees is reconstructable from the session log.

## Tools

| Tool | Effect | Terminal |
|---|---|---|
| `run_physical_assessment` | Runs one provider-mediated assessment; consumes one budget slot even on failure. | no |
| `finish_investigation` | Finishes an active investigation whose evidence is satisfied. | yes (concludes the turn) |
| `stop_unknown` | Stops an active investigation as unresolvable, with a durable reason. | yes (concludes the turn) |

No tool parameter touches lineage or the verdict: results come from the provider through the service. A terminal guard denies all three tools once the investigation leaves the `active` phase.

## Model Experience

Three exclusive tools with generic args-only presentation and a guidance section (`tool:agentic-control`, order 115) describing the macro-action policy.

#### KV Cache effect

The pre-step projection appends a new snapshot message only on state revision changes, so unchanged state never invalidates a request prefix.

## Known Limitations and Deferred Work

- **No capability router or ledger** — the three macro-actions are the whole model surface in P0; experience and self-improvement loops are explicitly out of scope.
