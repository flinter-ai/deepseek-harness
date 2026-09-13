---
description: "在现有 llm-pi-ai 路由之上提供 Relace Search 与 Instant Apply 协议的可选 DSH 原生插件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-relace

[English](README.md) | 中文

这是一个可选的 DSH 原生插件，将 Relace Search 和 Instant Apply 的请求协议、严格工具 schema、凭据引用、响应解析和宿主回调桥接封装为可复用包。它可以同时服务本地 harness、EC2 或其他计算宿主，避免复制部署代码。

插件不拥有文件系统、Shell 权限、Git 写入、Secrets Manager、systemd 或计算后端；这些能力仍由宿主提供，OpenRouter 传输仍由 `llm-pi-ai` 负责。凭据字段只有引用名称，真实值由凭据 seam 在请求时解析。

将 `buildRelaceProviderProfiles()` 的结果合并到现有的 `llm-pi-ai` 配置中，宿主需要 Relace 协议 helper 时再加载 `Relace` 插件。

## 模型体验

### Relace Search

#### 模型看到的内容

模型会看到五个名称稳定且启用严格 schema 的 Relace 工具：`view_file`、`view_directory`、`grep_search`、`bash` 和 `report_back`。插件只将经过验证的参数转交给宿主回调，不会自行授予模型文件系统或 Shell 权限。

##### Tool roster

```markdown
view_file | view_directory | grep_search | bash | report_back
```

#### Token 影响

五个 schema 和 Search 提示词只出现在 Search 请求中，不会给普通 DSH 轮次增加工具。

##### Search request

```markdown
system prompt + five strict tool schemas + user query
```

#### KV Cache 影响

Search system prompt、工具顺序和 schema 都是确定的；宿主不变时可以复用 provider 的普通前缀缓存。

##### Stable prefix

```markdown
relace-search system prompt + tool schemas
```

### Relace Apply 3

#### 模型看到的内容

Apply-3 使用 `<instruction>`、`<code>` 和 `<update>` 格式接收请求，并返回规范化的合并代码；插件不会将结果写入磁盘。

##### Apply envelope

```markdown
<instruction>...</instruction>
<code>...</code>
<update>...</update>
```

#### Token 影响

只有代码编辑请求和返回结果消耗 token；Apply 不会带上 Search 工具集合。

##### Apply request

```markdown
apply prompt + returned merged code
```

#### KV Cache 影响

每个编辑 envelope 对三个输入是确定的，但任何输入变化都会改变请求后缀。

##### Apply prefix

```markdown
the request prefix is reused only when the envelope is unchanged
```
