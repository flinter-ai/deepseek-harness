# DSH source controller

`@deepseek-ai/dsh-api-source-controller` 是浏览器源码草稿共用的 Host/Client 接口。Sandpack 和直接运行在 DSH Web 上的编辑器使用同一个 Remote API；Host 负责持久化草稿、版本围栏、路径限制和 Session 生命周期校验。

Client 包还导出不依赖 React 的 `SourceDraftModel` 编辑器适配器。Sandpack 或其他编辑器只需把完整文件快照交给它，显式调用 `save()`，并订阅不可变快照即可获得 `dirty`、`conflict`、`saved` 和 `published` 状态。`publish()` 会拒绝尚未保存的本地文件，避免 UI 意外发布过时缓冲区。

`SourceDraftModel` 有意不等同于 DSH memory plugin。草稿文件和 revision
状态只保存在 `source_drafts` storage domain 中，不会复制到 MCP memory、Session
日志、prompt 或模型可见的 tool。需要模型记住的项目事实或决定，应另外使用可选的
memory MCP。

```ts
const model = new SourceDraftModel(ctx.sourceDrafts, {
  sessionId,
  baseSha,
  files: sandpackFiles,
})

model.setFiles(nextSandpackFiles)
await model.save()
await model.publish()
```

## Model Experience

### 浏览器源码草稿

#### What the model sees

不会直接进入模型上下文。`sourceDrafts` 将浏览器编辑状态保存在 Session 日志之外，不添加 prompt、tool 或模型事件；只有显式挂载的 `SourcePublisher` 才可能把已接受的草稿转换为 Host 侧 Git 操作。

#### Token effect

草稿操作为零。文件内容、revision 和发布结果不会由本包插入模型请求。

#### KV Cache effect

独立。保存或发布浏览器源码草稿不会改变模型请求前缀，也不会使 provider cache 失效。

## Known Limitations and Deferred Work

- 默认 web bundle 不挂载 Git/PR publisher；在 EC2 或其他 Host 组合专用 publisher、worktree 和凭据策略之前，`publish` 会返回 `publisher-unavailable`。浏览器草稿会拒绝密钥和仓库元数据路径。
