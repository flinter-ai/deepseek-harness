# Agent Note: DeepSeek output caps are optional

Status: implemented

English | [中文](2026-08-29-deepseek-optional-max-tokens.zh.md)

## Problem

The DeepSeek chat-completions adapter supplied a hidden `256000` output-token cap when neither the deployment nor the request configured one. OpenAI-compatible deployments can expose models with lower output limits, so a pass-through model could receive a request the selected provider rejects before generation.

## Decision

`maxTokens` is optional at the adapter and catalog-entry levels. Resolution preserves an explicit model or adapter cap, and leaves `defaultMaxTokens` absent when neither is configured. The existing serializer therefore omits `max_tokens`, allowing the selected provider to apply its own model-specific default. Explicit request and agent options continue to win and continue to serialize as `max_tokens`.

The adapter does not infer a provider limit from `contextWindow`. Deployments that need a fixed output budget can continue to configure `maxTokens` at the adapter or model entry.

## Consequences

Unconfigured DeepSeek requests use the provider's default output budget. Configured caps retain their existing precedence, validation, request logging, and wire behavior. Auto-compaction does not use this adapter default; its own request options remain unchanged.

## Testing

The adapter suite verifies omission on the wire, absence from resolved model metadata when unset, preservation of configured adapter and model caps, explicit request precedence, and invalid-cap rejection. The complete `llm-deepseek` adapter suite passes.
