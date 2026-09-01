# @deepseek-ai/dsh-llm-workbuddy

[English](README.md) | 中文

面向独立 WorkBuddy2API 网关的本地 DSH 提供方适配器。

该适配器通过共享的 `llm-pi-ai` OpenAI Completions 传输注册 `workbuddy` 路由；它不包含也不启动网关。

- 适配器：`packages/llm/llm-workbuddy`
- 网关：`/Users/oldap/workbuddy2api`
- 默认端点：`http://127.0.0.1:8000/v1`
- 凭据引用：`WORKBUDDY_API_KEY`

## 已知限制与后续工作

- 模型目录是独立网关模型注册表的固定快照。
- 适配器通过共享的 pi-ai 传输处理聊天补全；它不启动网关，也不新增图片路由。
- 默认端点仅绑定本机回环地址。远程或其他绑定位置必须显式设置 `baseURL`，并单独进行运行安全评估。
