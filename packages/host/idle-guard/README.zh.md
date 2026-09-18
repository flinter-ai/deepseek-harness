---
description: "仅限宿主机的脱敏活动状态，供部署层拥有的空闲关机控制器使用；本包从不自行决定或执行机器关机。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-idle-guard

[English](README.md) | 中文

## 概述

这个可选宿主插件只写入版本化 JSON 快照：最近一次已接受的 Web 活动时间，以及活动 HTTP 请求、WebSocket、后台任务和 PTY 会话数量。默认关闭。EC2 部署可以开启它，再由独立的 systemd timer 执行 30 分钟空闲策略。

插件不会读取或写入凭据、请求正文、会话内容或 provider 状态；不会调用 AWS、停止实例，也不会暴露关机 endpoint。部署控制器必须把缺失或过期状态解释为“不要关机”。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用

在 `webServer` 之后组合 `@deepseek-ai/dsh-host-idle-guard`，设置 `enabled: true` 和由运维拥有的绝对 `stateFile`。它会在每次刷新时探测可选的 `jobs` 与 `terminals` 服务。只有在 composition 明确没有 PTY service 时才能设置 `ptyMode: absent`，随附的 Web bundle 正是如此；否则默认的 `required` mode 会把缺少 terminal 计数视为不安全。默认每 30 秒刷新一次，并原子替换文件。若必需的执行计数不可用，它会写入 `capabilitiesReady: false`；部署控制器必须保持主机运行。只有在能力完整时，控制器才应取得共享部署锁、重新读取状态、确认四个计数均为零且时间戳至少已过去 30 分钟，并在自身服务策略允许时停止主机。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

插件通过 Cordis reflection 观察 Web 活动和可选的进程 registry，原子写入带 schema version 的状态，并且从不拥有停止决定。部署脚本会独立检查 service 状态、新鲜度、计数器和共享锁，然后才调用机器生命周期边界。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Host Web server](../webserver/README.zh.md)——请求和 WebSocket 活动来源。
- [EC2 deployment](../../../deploy/dsh-ec2/README.zh.md)——空闲停止策略与 systemd unit。
- [配置目录](../../../docs/config-catalog.zh.md)——生成的包元数据。

-----

<a id="model-experience"></a>
## 模型体验

### 宿主生命周期策略

#### 模型看到什么

不会直接看到任何内容。这个宿主服务不提供模型可见工具、prompt、消息或用户 内容字段；它只向部署控制器发布脱敏的进程事实。

#### Token 影响

无。活动快照不会加入 provider request 或模型上下文。

#### KV Cache 影响

无。更新本地生命周期快照不会改变模型请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 策略刻意保守：任一活动请求、WebSocket、任务或 PTY 都会阻止空闲关机。
- 状态文件是本地运维证据，不是持久会话存储。
- 插件不拥有 EC2 电源操作；部署单元拥有不可逆边界，并必须在状态缺失或过期时安全失败。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
