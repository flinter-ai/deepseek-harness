import { describe, expect, it } from 'vitest'
import {
  CodeSandboxSdkRuntime,
  type CodeSandboxSdkClient,
} from '../src/codesandbox-sdk.ts'

describe('official CodeSandbox SDK runtime', () => {
  it('maps bounded private VM options and disposes the SDK session', async () => {
    let createOptions: Record<string, unknown> | undefined
    let connectOptions: Record<string, unknown> | undefined
    let runOptions: Record<string, unknown> | undefined
    let disposed = 0
    let shutdownId: string | undefined
    const command = {
      async waitUntilComplete() { return 'sdk-runtime-ok' },
      async kill() {},
    }
    const client = {
      commands: {
        async runBackground(commandText: string, options: Record<string, unknown>) {
          runOptions = { command: commandText, ...options }
          return command
        },
      },
      dispose() { disposed += 1 },
    }
    const sandbox = {
      id: 'sandbox-1',
      async connect(options: Record<string, unknown>) {
        connectOptions = options
        return client
      },
    }
    const sdk = {
      sandboxes: {
        async create(options: Record<string, unknown>) {
          createOptions = options
          return sandbox
        },
        async shutdown(id: string) { shutdownId = id },
      },
    } as unknown as CodeSandboxSdkClient

    const runtime = new CodeSandboxSdkRuntime({
      sdk,
      title: 'DSH test worker',
      description: 'No credentials',
      tags: ['dsh', 'test'],
    })
    const managed = await runtime.createSandbox({
      templateId: 'template-1',
      vmTier: 'micro',
      hibernationTimeoutSeconds: 120,
      automaticWakeupConfig: { http: true, websocket: false },
    })
    const connected = await managed.connect({
      env: { DSH_COMPUTE_BACKEND: 'codesandbox', DSH_CALLBACK_HMAC_SECRET_REF: 'ref-only' },
    })
    const running = await connected.commands.runBackground(['/opt/dsh/bin/dsh', 'literal task'], {
      cwd: '/project/sandbox',
      env: { DSH_COMPUTE_BACKEND: 'codesandbox' },
    })

    await expect(running.waitUntilComplete()).resolves.toBe('sdk-runtime-ok')
    await runtime.disposeSandbox(managed)

    expect(createOptions).toMatchObject({
      id: 'template-1',
      privacy: 'private',
      title: 'DSH test worker',
      description: 'No credentials',
      tags: ['dsh', 'test'],
      hibernationTimeoutSeconds: 120,
      automaticWakeupConfig: { http: true, websocket: false },
    })
    expect((createOptions?.vmTier as { name?: string }).name).toBe('Micro')
    expect(connectOptions).toMatchObject({
      permission: 'write',
      env: { DSH_COMPUTE_BACKEND: 'codesandbox', DSH_CALLBACK_HMAC_SECRET_REF: 'ref-only' },
    })
    expect(runOptions).toMatchObject({
      command: "cd '/project/sandbox' && exec '/opt/dsh/bin/dsh' 'literal task'",
      env: { DSH_COMPUTE_BACKEND: 'codesandbox' },
    })
    expect(disposed).toBe(1)
    expect(shutdownId).toBe('sandbox-1')
    expect(JSON.stringify({ createOptions, connectOptions, runOptions })).not.toContain('API_KEY')
  })

  it('seeds a tracked source archive and stamps the exact source revision', async () => {
    let uploadedPath: string | undefined
    let uploadedBytes: Uint8Array | undefined
    let seedCommand: string | undefined
    let seedCwd: string | undefined
    let disposed = 0
    let shutdownId: string | undefined
    const client = {
      fs: {
        async writeFile(path: string, content: Uint8Array) {
          uploadedPath = path
          uploadedBytes = content
        },
      },
      commands: {
        async run(command: string, options: { cwd: string }) {
          seedCommand = command
          seedCwd = options.cwd
          return 'seeded'
        },
      },
      dispose() { disposed += 1 },
    }
    const sandbox = {
      id: 'sandbox-seeded',
      async connect() { return client },
    }
    const sdk = {
      sandboxes: {
        async create() { return sandbox },
        async shutdown(id: string) { shutdownId = id },
      },
    } as unknown as CodeSandboxSdkClient
    const archive = new Uint8Array([1, 2, 3])
    const sourceSha = 'a'.repeat(40)
    const archiveSha256 = 'b'.repeat(64)
    const runtime = new CodeSandboxSdkRuntime({
      sdk,
      workspaceSeed: { archive, sourceSha, archiveSha256 },
    })

    const managed = await runtime.createSandbox({
      vmTier: 'pico',
      hibernationTimeoutSeconds: 120,
      automaticWakeupConfig: { http: true, websocket: false },
    })
    await runtime.disposeSandbox(managed)

    expect(uploadedPath).toBe('/tmp/dsh-source.tar.gz')
    expect(uploadedBytes).toBe(archive)
    expect(seedCwd).toBe('/project/sandbox')
    expect(seedCommand).toContain(`'${archiveSha256}'`)
    expect(seedCommand).toContain(`'${sourceSha}'`)
    expect(seedCommand).toContain('--no-same-owner')
    expect(disposed).toBe(1)
    expect(shutdownId).toBe('sandbox-seeded')
  })

  it('requires a host token when no SDK test double is supplied', () => {
    const previous = process.env.CSB_API_KEY
    delete process.env.CSB_API_KEY
    try {
      expect(() => new CodeSandboxSdkRuntime()).toThrow(/CSB_API_KEY/)
    } finally {
      if (previous === undefined) delete process.env.CSB_API_KEY
      else process.env.CSB_API_KEY = previous
    }
  })
})
