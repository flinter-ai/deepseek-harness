---
description: "Bounded deterministic reasoning evidence bank for DSH."
kind: "package-reference"
---

# @deepseek-ai/dsh-reasoning-bank

English | [中文](README.zh.md)

This package provides a process-local FIFO bank for accepted trace metadata and bounded evidence IDs. It deduplicates by trace identity and supports deterministic text search. The optional function plugin exposes the bank under the `flinterReasoningBank` service key with `ctx.provide`; callers read the optional service with `ctx.get()`.

Only `id`, trace kind, producer SHA, run ordinal, a bounded summary, bounded cue/lesson text, and bounded evidence IDs are retained. Full payloads, prompts, chain of thought, secrets, and media are outside the accepted fields and are never stored.

```ts
import { apply, Config, inject, name, type ReasoningBank } from '@deepseek-ai/dsh-reasoning-bank'

await ctx.plugin({ name, inject, Config, apply }, { enabled: true, maxEntries: 128 })
const bank = ctx.get('flinterReasoningBank') as ReasoningBank
bank.ingest(metadata, { status: 'completed', abstained: false, evidenceIds: ['event-1'] })
```

The fixture tests cover bounds, deduplication, FIFO eviction, search, malformed evidence rejection, service registration, and disposal. The package is a host-only seam: current DSH master has no self-improving consumer or durable reasoning-bank backend, so mounting it does not change the shipped default composition and does not claim provider or production persistence.

## Model Experience

### Accepted trace metadata retained for a host consumer

#### What the model sees

Nothing directly. The bank is a host-only service and registers no prompt, tool schema, or model request content. A future self-improving consumer may query bounded summaries and evidence IDs through `ctx.get('flinterReasoningBank')`, but that consumer owns any model-facing projection.

#### Token effect

Zero direct tokens. Ingesting or searching an entry does not append text to the active DSH request; a future consumer's prompt or auxiliary request remains its own contract.

#### KV Cache effect

No direct invalidation: the package contributes no request tokens and does not mutate a request prefix. Only a separately mounted consumer that renders a bank result can change the next request.

## Known Limitations and Deferred Work

- **Process-local retention** — entries disappear with the host process; durable storage, cross-worker synchronization, and replay remain a separate integration seam.
- **No trace emitter wiring in this package** — a current trace producer must explicitly select accepted metadata and call `ingest`; raw traces, payloads, prompts, chain of thought, secrets, and media are outside this contract.
- **No self-improving consumer is shipped yet** — the service is ready for a later controller or reasoning-review plugin, but it does not make autonomous policy or prompt changes.
