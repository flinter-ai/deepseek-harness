# Agent Note: AWS credential provider keeps browser grants local

Status: implemented

[English](2026-09-06-aws-credential-provider-browser-records.md) | 中文

## Problem

AWS 凭据引用 provider 在 DSH Web 启动期间拒绝记录操作，但浏览器连接层使用进程内的授权记录保存会话 cookie。因此，虽然 Secrets Manager 的模型 API key 引用解析正常，挂载该 provider 仍会导致服务反复重启。

## Decision

provider 在一个 DSH 进程的生命周期内使用内存 map 保存凭据记录。它支持这些记录的读取、描述、列出、修改和删除，但不会将记录发送到 AWS。模型和 provider 的 API key 仍然是请求时从 Secrets Manager 解析的引用，AWS 写入默认保持禁用。

## Alternatives considered

**拒绝所有记录操作。** 否决：Web 连接层需要记录 seam 保存临时浏览器授权，拒绝记录会使组装后的 Web profile 无法启动。

**将浏览器授权保存在 Secrets Manager。** 否决：浏览器授权状态是进程内且短期的；将它与部署凭据一起存储会扩大 secret store 的职责和保留范围。

**将 API key 复制到环境变量。** 否决：请求时解析可以让轮换后的值立即生效，并使值不进入 systemd 配置、`/proc` 或子进程继承环境。

## Consequences

DSH 进程重启后浏览器授权会丢失并重新生成。AWS 后端的 API key 引用仍可在每次请求中使用，而不会将值物化到配置或会话记录中。provider 的聚焦测试覆盖了本地记录的完整生命周期和只读 AWS 引用路径。
