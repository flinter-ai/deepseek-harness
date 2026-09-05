# Agent Note: DSH 2API 凭据设置

Status: implemented

[English](2026-09-05-dsh-2api-credential-settings.md) | 中文

## 问题

本地 DSH Web 门户已有 Host 凭据接缝与独立的本地 2API 服务，但没有一个浏览器界面集中管理 WorkBuddy 路由与 Gemini2API 管理 relay 所需的两个密钥。把任一密钥值放进 `settings.yaml` 都会越过设置的脱敏边界，使密钥成为普通配置状态的一部分。

## 决策

Web 组合挂载 `@deepseek-ai/dsh-client-ui-settings-2api-keys` 这个只含客户端的插件；它向现有的插件设置分区贡献一个 `2API 密钥`标签页。标签页拥有两条固定记录：既有 WorkBuddy 适配器消费的 `WORKBUDDY_API_KEY`，以及 Gemini2API 的主密钥 `API_KEY`（当 `ADMIN_API_KEY` 留空时由管理界面和 Chrome 保活插件消费）。

每条记录通过 `credentials.describe` 读取配置、来源与可写元数据，并以空的密码输入框开始。保存时只通过 `credentials.set` 发送去除首尾空白的值；删除前需要在页面内确认，然后调用 `credentials.unset`。组件从未接收已解析的凭据值，通用 UI 失败也不会回显传输细节或密钥。只读环境来源会禁用编辑，并说明必须修改启动环境。

本包作为独立的 `dsh.client` bundle，而不是修改插件分区拥有方。它遵循分区的标签页 slot，自有文案与 CSS，并加入已交付的 Web 浏览器 roster。标签页只管理 DSH 自己的凭据存储，不会重写 Gemini2API 仓库的 `.env`、修改 WorkBuddy 服务环境、新增 Gemini 模型适配器，也不会执行 relay 健康检查。

## 考虑过的替代方案

**把密钥值写入 `settings.yaml`。** 否决：设置描述会脱敏，设置也不是密钥的拥有方；写入字面值还会扩大所有配置读取与修改路径的暴露范围。

**把记录加入现有的通用插件卡包。** 否决：这是一个没有设置 namespace 的独立用户可见提供方密钥界面；客户端 bundle 规则也要求 feature 自有标签页与分区拥有方的值导入保持独立。

**在本次变更中新增 Gemini 模型适配器。** 暂缓：当前请求是为本地 relay 与 Chrome 集成管理密钥；让 DSH 路由 Gemini 请求会引入单独的提供方契约与模型目录决策。

## 结果

用户可以在 Settings 中新增、替换、查看元数据并删除两个本地 2API 密钥。成功写入会持久化到 `$DSH_HOME/.credentials.yaml`，匹配引用的消费者在下一次操作中解析时即可使用。页面只证明 DSH 凭据提供方接受了写入；服务可达性与外部 `.env` 同步仍是独立操作。

引用被有意固定并可见，因此页面可以管理现有消费者使用的确切引用，而不需要凭据枚举 API。增加其他提供方时，需要明确添加记录及其消费者契约，而不是默默暴露任意凭据名称。`ADMIN_API_KEY` 仍可作为 Gemini2API 的独立可选凭据；本标签页不管理它，因为本机部署使用主 `API_KEY` 回退。

每条记录还会显示已经核对过的本机重启命令：WorkBuddy 的 `launchd` kickstart 命令或本机 Gemini2API 虚拟环境启动命令。复制按钮只把这段静态命令写入浏览器剪贴板；页面不会执行 shell 命令，命令也不会把 DSH 凭据复制到任一服务的 `.env` 文件。
