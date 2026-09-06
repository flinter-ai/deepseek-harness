# @deepseek-ai/dsh-client-ui-settings-2api-keys

[English](README.md) | 中文

Web 设置中的浏览器专用本地 relay 密钥标签页。本包向现有的“插件”分区贡献第三个标签页，管理本地集成使用的三个固定凭据引用：DSH 的 WorkBuddy 兼容路由使用 `WORKBUDDY_API_KEY`，Gemini2API 使用主密钥 `API_KEY`，zcode2api 使用网关密钥 `ZCODE_API_KEY`。

Host 只描述每个引用的配置、来源与可写状态，不返回密钥值，因此页面只展示这些元数据。输入密钥后，值只通过一次 `credentials.set` 发送；删除密钥时发送 `credentials.unset`。Host 的本地凭据提供方把值以仅所有者可读的权限保存到 `$DSH_HOME/.credentials.yaml`，不会写入 `settings.yaml`。启动环境提供的只读密钥会显示为只读，不会假装文件写入改变了实际生效的值。

本页面管理 DSH 自己的凭据存储，不会修改 `/Users/oldap/gemini2api/.env`、zcode2api 的 `.env`/SQLite 存储、WorkBuddy 自己的进程环境，也不会测试 relay 是否可访问；服务自身的环境发生变化时仍须单独配置或重启。

每张卡片还会显示对应服务在本机上的重启命令，并提供复制按钮。命令只展示给用户在 Terminal 中运行；浏览器不会执行命令，复制也不会把 DSH 凭据存储同步到任一服务的 `.env` 文件。

zcode2api 卡片还会显示本机安装的“轮换并重新登录”复制命令。运行后它会生成新的网关密钥并重启 zcode2api；然后把新密钥粘贴到 Kimi Code 的 `zcode2api` provider，并把同一个密钥保存到 DSH 卡片。这是客户端重新绑定步骤；页面不会执行轮换命令。

## 模型体验

无，因为本包只渲染浏览器设置界面，不注册任何模型接口。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **三个固定引用** —— 标签页有意只管理 `WORKBUDDY_API_KEY`、`API_KEY` 与 `ZCODE_API_KEY`；凭据接缝不会枚举密钥值，因此它不是通用的凭据枚举器。
- **没有 relay 健康检查** —— 保存只证明 DSH Host 接受了凭据，并不证明 relay 正在运行，也不证明服务接受该密钥。
- **服务指令只可复制** —— 标签页显示已核对的本机 `launchd` 与 zcode 轮换命令，但不会执行 shell 命令或重启服务。服务管理员密钥仍与这些客户端网关密钥分开。
- **不会同步服务存储** —— DSH 保存的是 worker 启动时使用的客户端副本；zcode2api 与 Gemini2API 各自保留权威的本机服务配置。
