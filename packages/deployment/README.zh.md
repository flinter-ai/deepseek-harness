---
description: "deployment package 组：用于为受支持主机组装不可变 runtime artifact 的私有 composition root。"
kind: "package-group"
---

# deployment/：runtime artifact 打包

[English](README.md) | 中文

## 概述

`deployment/` 组包含用于组装可复现 DSH runtime artifact 的私有 composition root。将这些 package 作为主机部署的构建输入；它们不是另一套 DSH 应用启动器。主机脚本、service unit、IAM policy 与持久状态仍位于 `deploy/` 和目标主机上。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

该组目前包含一个私有 artifact composition root。

| 包 | 角色 |
|---|---|
| [`dsh-ec2-runtime/`](dsh-ec2-runtime/README.zh.md) | 固定不可变 DSH Web EC2 runtime artifact 中要 stage 的依赖闭包 |

<a id="related-documentation"></a>
## 相关文档

- [EC2 部署流程](../../deploy/dsh-ec2/README.zh.md)——artifact 构建、校验、激活与回滚边界。
- [bundle 组映射](../bundle/README.zh.md)——artifact root 所挂载的 upstream composition layer。

<a id="dev-note"></a>
## 开发备注

无。
