# @deepseek-ai/dsh-client-ui-settings-2api-keys

[English](README.md) | 中文

Web 设置中的浏览器专用 **2API 密钥**标签页。本包向现有的“插件”分区贡献第三个标签页，管理本地集成使用的两个凭据引用：DSH 的 WorkBuddy 兼容路由使用 `WORKBUDDY_API_KEY`，Gemini2API 的主密钥 `API_KEY` 用于管理界面与 Chrome 保活插件。

Host 只描述每个引用的配置、来源与可写状态，不返回密钥值，因此页面只展示这些元数据。输入密钥后，值只通过一次 `credentials.set` 发送；删除密钥时发送 `credentials.unset`。Host 的本地凭据提供方把值以仅所有者可读的权限保存到 `$DSH_HOME/.credentials.yaml`，不会写入 `settings.yaml`。启动环境提供的只读密钥会显示为只读，不会假装文件写入改变了实际生效的值。

本页面管理 DSH 自己的凭据存储，不会修改 `/Users/oldap/gemini2api/.env`、WorkBuddy 自己的进程环境，也不会测试任一 relay 是否可访问；服务自身的环境发生变化时仍须单独配置或重启。

每张卡片还会显示对应服务在本机上的重启命令，并提供复制按钮。命令只展示给用户在 Terminal 中运行；浏览器不会执行命令，复制也不会把 DSH 凭据存储同步到任一服务的 `.env` 文件。

## 模型体验

无，因为本包只渲染浏览器设置界面，不注册任何模型接口。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **两个固定引用** —— 标签页有意只管理 `WORKBUDDY_API_KEY` 与 `API_KEY`；凭据接缝不会枚举密钥值，因此它不是通用的凭据枚举器。
- **没有 relay 健康检查** —— 保存只证明 DSH Host 接受了凭据，并不证明 WorkBuddy 或 Gemini2API 正在运行，也不证明服务接受该密钥。
- **重启指令只可复制** —— 标签页显示已核对的 WorkBuddy 与 Gemini2API `launchd` 命令，但不会执行 shell 命令或重启服务。使用 Gemini2API 的重启指令前，先安装本机 launchd 服务。
- **Gemini2API 仍是外部消费者** —— DSH 会为本地 relay 集成保存 `API_KEY`，但本包不新增 Gemini 模型适配器，也不改变 Chrome 扩展的 URL 与轮询设置。
