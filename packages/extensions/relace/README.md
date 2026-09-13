---
description: "Optional native DSH contract plugin for Relace Search and Instant Apply over an existing llm-pi-ai route."
kind: "package-reference"
---

# @deepseek-ai/dsh-relace

English | [中文](README.zh.md)

This optional plugin packages the Relace Search and Instant Apply contracts so
they can be reused by the local harness, EC2, or another compute host without
copying deployment code. It owns request formatting, strict tool schemas,
credential references, response parsing, and the host callback bridge.

It deliberately does not own filesystem access, shell policy, Git writes,
Secrets Manager, systemd, or the compute backend. The host supplies those
capabilities, and `llm-pi-ai` remains the generic OpenRouter transport.

Compose the result of `buildRelaceProviderProfiles()` into the existing
`llm-pi-ai` configuration, then load the `Relace` plugin when the host wants
the protocol helpers.

The plugin does not silently mount a second `llm-pi-ai` instance: this avoids
route collisions when a host already has a configurable provider plugin. The
returned credential references are names only; values are resolved by the
credential seam at request time.

## Model Experience

### Relace Search

#### What the model sees

The model receives five strict Relace tools with stable names: `view_file`, `view_directory`, `grep_search`, `bash`, and `report_back`. The plugin only forwards validated arguments to host callbacks; it never grants filesystem or shell authority by itself.

##### Tool roster

```markdown
view_file | view_directory | grep_search | bash | report_back
```

#### Token effect

The five schemas and the Search prompt are included only in a Search request; they do not add tools to ordinary DSH turns.

##### Search request

```markdown
system prompt + five strict tool schemas + user query
```

#### KV Cache effect

The Search system prompt, tool order, and schemas are deterministic, so an unchanged host can reuse the provider's normal prefix cache.

##### Stable prefix

```markdown
relace-search system prompt + tool schemas
```

### Relace Apply 3

#### What the model sees

Apply-3 receives the documented `<instruction>`, `<code>`, and `<update>` envelope and returns normalized merged code. The plugin never writes the result to disk.

##### Apply envelope

```markdown
<instruction>...</instruction>
<code>...</code>
<update>...</update>
```

#### Token effect

Only the code-edit request and returned completion contribute tokens; Apply does not include the Search tool set.

##### Apply request

```markdown
apply prompt + returned merged code
```

#### KV Cache effect

Each edit envelope is deterministic for its three inputs, but changing any input changes the request suffix.

##### Apply prefix

```markdown
the request prefix is reused only when the envelope is unchanged
```
