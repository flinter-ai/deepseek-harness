# @deepseek-ai/dsh-llm-workbuddy

English | [中文](README.zh.md)

Local DSH provider adapter for the separate WorkBuddy2API gateway.

The adapter registers a workbuddy route through the shared llm-pi-ai
OpenAI-completions transport. It does not contain or launch the gateway.

- Adapter: packages/llm/llm-workbuddy
- Gateway: /Users/oldap/workbuddy2api
- Default endpoint: `http://127.0.0.1:8000/v1`
- Credential reference: WORKBUDDY_API_KEY

## Known Limitations and Deferred Work

- The model catalog is a fixed snapshot of the separate gateway registry.
- The adapter covers chat completions through the shared pi-ai transport; it does not launch the gateway or add image routes.
- The default endpoint is loopback-local. A remote or differently bound gateway requires an explicit `baseURL` and its own operational security review.
