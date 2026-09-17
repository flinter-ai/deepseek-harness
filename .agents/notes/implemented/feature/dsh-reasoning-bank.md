# DSH reasoning bank

English | [中文](dsh-reasoning-bank.zh.md)

Added `@deepseek-ai/dsh-reasoning-bank`, a bounded deterministic FIFO service for accepted trace metadata and evidence IDs. It exposes an optional Cordis `ctx.provide` seam read through `ctx.get`, rejects non-accepted results and malformed evidence identifiers, and retains no payloads, secrets, chain of thought, or media. Focused tests cover configuration, bounds, deduplication, eviction, search, service disposal, and the plugin enable/disable path. This is an opt-in host seam for a future self-improving consumer; it is not wired into the default composition or a durable backend.
