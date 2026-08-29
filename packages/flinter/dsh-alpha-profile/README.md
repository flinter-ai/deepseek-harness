# `@deepseek-ai/dsh-alpha-profile`

Status: **PHASE1_REFERENCE** (implemented before this scaffold branch).

The alpha candidate already contains the tested local `tod` profile, provider
selection, model-level context-window and reasoning controls, and process
evidence. The repository’s established package name is retained; this file
does not create a duplicate `@flinter/dsh-alpha-profile` runtime package.
Future FLINTER capability layers remain separate packages and profiles.

## Model Experience

### Alpha model selection

#### What the model sees

The selected profile exposes model-level `contextWindow` capacity and user-selectable `reasoningEffort` metadata; this README describes the existing Phase 1 reference and adds no second runtime profile.

#### Token effect

`contextWindow` bounds the available request context, while the selected reasoning effort controls provider request configuration.

#### KV Cache effect

This profile registers no separate KV-cache policy; provider-reported cache usage remains authoritative.
