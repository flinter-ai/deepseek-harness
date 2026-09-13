---
description: "用于组装不可变 DSH Web EC2 runtime artifact 的私有依赖根。"
kind: "package-reference"
---

# @deepseek-ai/dsh-ec2-runtime

[English](README.md) | 中文

## Summary

这个私有 package 是 deployment composition root，不是第二个 DSH 应用。它的生产
依赖闭包包含标准 DSH CLI/Web runtime、FLINTER alpha profile 和 AWS worker profile，
因此 CI 可以生成一个经过校验的 EC2 artifact，而无需在主机上安装 workspace 依赖。

它还把 AWS Secrets Manager provider、source draft、source controller、
Sandpack editor 和 host GitHub publisher 作为直接 root 固定在闭包中；上游
Web bundle 的依赖变化不能静默地移除这些发布契约。

## Contents

- `package.json` 声明要被 stage 的 runtime roots；
- `runtime-bootstrap.mjs` 转发到标准 `@deepseek-ai/dsh` CLI；
- `deploy/dsh-ec2/build-runtime-artifact.ts` 创建并校验 archive。

该 package 不拥有 credentials、settings、Git state、AWS policy、service unit 或持久
session data。这些仍由主机拥有，并位于 immutable release directory 之外。

## Model Experience

### Runtime composition context

#### What the model sees

这个 package 不新增 prompt、tool 或 session content。它只把已经组合好的 DSH CLI/Web、alpha profile、AWS worker profile、source draft/controller/editor、host publisher 和 credential-provider package 放进 release artifact。

##### Artifact composition

```markdown
@deepseek-ai/dsh-ec2-runtime
```

#### Token effect

None。选择这个 composition root 只改变打包的 runtime closure，不改变发送给 model 的
request text。

#### KV Cache effect

None。artifact composition 不改变 canonical session prompt prefix；provider cache 行为
仍由选中的 DSH profile 负责。

## Known Limitations and Deferred Work

- 第一个 P0 closure 仍包含 CodeSandbox 依赖，因为 alpha profile 目前把它声明为
  runtime dependency。将该 backend 拆成 lazy optional package 是计划中的 P1 优化；
- artifact 发布和 EC2 激活仍属于 deployment layer；这个 package 不创建 bucket、IAM
  role 或 systemd state。
