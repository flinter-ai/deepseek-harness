---
description: "Revision-safe DSH Web draft/save/publish protocol with host-owned storage, authentication, Git, and PR adapters."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-draft

English | [中文](README.zh.md)

This package provides the framework-neutral draft protocol used by a DSH Web editor, Sandpack surface, or another source editor. SourceDraftModel keeps local files and dirty state, serializes saves, detects revision conflicts, refuses to publish unsaved content, and retains local dirty files after a remote delete.

DraftProtocol is the host-side service. It receives a DraftStore and DraftPublisher; the host remains the owner of durable storage, authentication, Git, and PR writes. Browser code receives only file snapshots, revisions, and publish receipts. It never receives storage or Git credentials.

The protocol is compute-independent. The editor can use dsh-compute with sandpack for browser preview or ec2 for host execution while the same draft revision and publish rules remain in force.

```markdown
edit -> dirty -> serialized save -> saved revision -> host publish/PR
                         \-> conflict -> reload or deliberate replacement
```

## Model Experience

### Draft lifecycle

#### What the model sees

The model-facing layer sees explicit draft state and revision outcomes only when a host chooses to render them. It does not receive Git credentials, storage credentials, or an unsaved draft disguised as a published artifact.

##### Runtime contract

```markdown
local files -> revision-safe save -> saved revision -> explicit publish receipt
```

#### Token effect

Draft state and revision metadata add no model prompt content by default. Source files are sent only through an editor or host operation that explicitly requests them.

##### Prompt effect

```markdown
draft protocol metadata stays outside model messages by default
```

#### KV Cache effect

Saving or publishing a draft does not change the stable model prefix unless a consumer deliberately includes the changed source or receipt in a new prompt.

##### Stable prefix

```markdown
save and publish lifecycle remains outside model context
```
