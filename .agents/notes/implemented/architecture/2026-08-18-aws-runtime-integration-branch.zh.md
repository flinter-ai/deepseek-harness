# Agent Note：aws-runtime 集成分支与无密钥结构冒烟

状态：已实现

[English](2026-08-18-aws-runtime-integration-branch.md) | 中文

## 问题

三个独立开发的能力——Bedrock LLM provider（`flinter/llm-pi-ai-bedrock`）、AWS Secrets Manager 凭证 provider（`flinter/credentials-aws-secrets-manager`）与 Orca worker 桥（`flinter/dsh-orca-plugin`）——此前没有任何一个分支能证明它们的组合可行。组合失败（重复行、缺失服务、boot 阶段访问云端）否则只会在部署首次组合它们时才暴露。

## 决策

### `flinter/aws-runtime` 是 FLINTER AWS 集成主干

`master` 保持为上游的精确镜像（仅 fast-forward，不含产品代码）。三个能力分支以 `--no-ff` 合入 `flinter/aws-runtime`，保留各自的能力历史。未来的 FLINTER AWS 产品分支从 `aws-runtime` 切出，绝不从兄弟特性分支切出，也绝不合入 `master`。

### 组合正确性由无密钥结构冒烟证明

`examples/aws-headless/` 保存一个 profile 模板（`profile/package.json` 列出 `@deepseek-ai/dsh-base` 与 `@flinter/dsh-orca` 两个 bundle，`profile/cordis.patch.yml` 替换凭证存储并启用 catalog 的 `amazon-bedrock` 路由）以及 `tests/aws-headless.e2e.ts`。测试把该 profile 物化到临时 `DSH_HOME`——profile 本地的 `node_modules` 符号链接代替 `dsh plugin add`——并执行两道闸门：

- **组合闸门**：真实的 `--dump-config` CLI 路径输出中，每个能力的行恰好出现一次，本地凭证行存在但已禁用。
- **启动闸门**：基于真实 profile 层的进程内 `boot()` 激活全部三个能力（`ctx.credentials` 是 Secrets Manager provider，`amazon-bedrock` 是已注册的 LLM 路由，五个 Orca 工具已注册）并干净地 dispose。环境被剥去所有 `AWS_*` 变量并禁用 IMDS，因此 boot 期间的任何 AWS 调用都会立即失败；绿色 boot 即零网络调用的证明。

两道闸门都不需要凭证，也都不会发出 AWS 请求。带真实凭证的 live 冒烟是之后单独的、受控的测试。

## 备选方案

**用一个简单 prompt 启动 headless profile。** headless bundle 是一次性运行器：loader 就绪后会创建 agent 并调用默认模型，把结构检查变成真实的 Bedrock 调用。因此冒烟只基于 `dsh-base` 组合，且不创建任何 agent。

**对凭证 provider 使用 `instanceof`。** 测试通过 tsconfig `paths` 门面导入包的源码，而 Loader 通过 package exports 解析到 `lib/`；两个平面的类对象不同，因此断言使用 `constructor.name`。
