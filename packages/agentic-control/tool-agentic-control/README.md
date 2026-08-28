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

### State projection

#### What the model sees

When a harness-started investigation has a new durable revision, the plugin appends one source-attributed state snapshot before the next model step. It describes the candidate, evidence status, independently assessed physical dimensions, provider-authored lineage, phase, and attempt budget; the model cannot start an investigation or author lineage.

#### Token effect

Each durable revision that reaches a pre-step adds one compact user-role state snapshot; an unchanged revision adds no projection tokens.

#### KV Cache effect

The projection is append-only after the existing request prefix. A changed state adds suffix content and does not rewrite earlier prompt tokens.

### Tool schemas

#### What the model sees

When visible, the three exclusive schemas `run_physical_assessment`, `finish_investigation`, and `stop_unknown` expose bounded macro-actions with generic argument-only presentation; their generated [tool-catalog section](../../../docs/tool-catalog.md#deepseek-aidsh-tool-agentic-control) records the exact schemas. The guidance section (`tool:agentic-control`, order 115) describes when to use them.

#### Token effect

The visible schemas and guidance add a fixed request-prefix cost while this plugin is active; call arguments and results add their own history tokens.

#### KV Cache effect

The schemas and guidance are prefix-stable while plugin registration and tool visibility remain unchanged. Registration or scoped visibility changes invalidate reuse from the first changed schema or guidance token.

### Tool results

#### What the model sees

`run_physical_assessment` returns the provider-authored physical dimensions, lineage, summary, evidence status, revision, and budget counters. The terminal tools return their phase, revision, and evidence status; failures remain explicit rather than becoming a fabricated verdict.

#### Token effect

Tool arguments and compact JSON results remain in the session history until compaction; the state projection is the separate revision-triggered context described above.

#### KV Cache effect

Calls and results append after the reusable request prefix. They do not invalidate earlier cache entries unless a separate state or tool-visibility change alters that prefix.

## Known Limitations and Deferred Work

- **No capability router or ledger** — the three macro-actions are the whole model surface in P0; experience and self-improvement loops are explicitly out of scope.
