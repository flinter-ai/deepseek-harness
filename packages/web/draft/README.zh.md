---
description: "具备 revision safety 的 DSH Web draft/save/publish protocol，由 host 拥有 storage、authentication、Git 和 PR adapter。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-draft

[English](README.md) | 中文

此 package 提供 framework-neutral 的 draft protocol，可供 DSH Web editor、Sandpack surface 或其他 source editor 使用。SourceDraftModel 管理 local file 和 dirty state，串行执行 save，检测 revision conflict，禁止发布未保存内容，并在 remote delete 后保留 local dirty file。

DraftProtocol 是 host-side service。它接收 DraftStore 和 DraftPublisher；host 继续拥有 durable storage、authentication、Git 和 PR 写入。browser 只会收到 file snapshot、revision 和 publish receipt，不会收到 storage 或 Git credential。

该 protocol 与 compute 无关。editor 可以使用 dsh-compute 的 sandpack 做 browser preview，也可以使用 ec2 做 host execution，同时继续使用同一套 draft revision 和 publish rule。

```markdown
edit -> dirty -> serialized save -> saved revision -> host publish/PR
                         \-> conflict -> reload or deliberate replacement
```

## Model Experience

### Draft lifecycle

#### What the model sees

面向 model 的 layer 只会在 host 选择渲染时看到显式 draft state 和 revision outcome，不会收到 Git credential、storage credential，也不会将未保存 draft 伪装成 published artifact。

##### Runtime contract

```markdown
local files -> revision-safe save -> saved revision -> explicit publish receipt
```

#### Token effect

除非明确请求，draft state 和 revision metadata 不会添加 model prompt 内容。只有 editor 或 host operation 显式请求时，source file 才会被发送。

##### Prompt effect

```markdown
draft protocol metadata stays outside model messages by default
```

#### KV Cache effect

除非 consumer 明确将变化后的 source 或 receipt 放入新 prompt，否则保存或发布 draft 不会改变稳定的 model prefix。

##### Stable prefix

```markdown
save and publish lifecycle remains outside model context
```
