/**
 * Official CodeSandbox SDK runtime for the platform-neutral compute seam.
 *
 * The SDK token belongs to the host that owns this runtime. It is used only
 * for CodeSandbox control-plane calls and is never copied into a sandbox
 * session environment. Provider credentials therefore remain outside the
 * compute VM until a separately reviewed credential broker exists.
 */

import {
  CodeSandbox,
  VMTier,
  type ClientOpts,
  type Command,
  type Sandbox,
  type SandboxClient,
} from '@codesandbox/sdk'
import type {
  CodeSandboxClient,
  CodeSandboxCommand,
  CodeSandboxCreateOptions,
  CodeSandboxRuntime,
} from './compute.ts'

/** The SDK surface required by this runtime; useful for deterministic tests. */
export interface CodeSandboxSdkClient {
  readonly sandboxes: Pick<CodeSandbox['sandboxes'], 'create' | 'shutdown'>
}

/** Host-only construction options for the official SDK runtime. */
export interface CodeSandboxSdkRuntimeOptions {
  /** API token supplied by a secret store or process environment. */
  readonly apiToken?: string
  /** Optional SDK transport configuration for the host. */
  readonly clientOptions?: ClientOpts
  /** Injected SDK surface for tests; production uses `apiToken`. */
  readonly sdk?: CodeSandboxSdkClient
  /** Metadata applied to managed private worker sandboxes. */
  readonly title?: string
  readonly description?: string
  readonly tags?: readonly string[]
  /** Optional tracked source archive to seed into each managed sandbox. */
  readonly workspaceSeed?: CodeSandboxWorkspaceSeed
}

/** A host-created, tracked-only source archive for one exact DSH revision. */
export interface CodeSandboxWorkspaceSeed {
  /** The archive bytes; provider credentials must not be included. */
  readonly archive: Uint8Array
  /** The exact source revision represented by `archive`. */
  readonly sourceSha: string
  /** SHA-256 of `archive`, computed by the host before the SDK call. */
  readonly archiveSha256: string
  /** Destination inside the sandbox workspace. Defaults to `/project/sandbox`. */
  readonly root?: string
}

interface NormalizedWorkspaceSeed extends CodeSandboxWorkspaceSeed {
  readonly root: string
}

type SdkSandbox = Pick<Sandbox, 'id' | 'connect'>
type SdkClient = Pick<SandboxClient, 'commands' | 'dispose'> & {
  readonly fs: Pick<SandboxClient['fs'], 'writeFile'>
}
type SdkCommand = Pick<Command, 'waitUntilComplete' | 'kill'>

const SDK_TIERS = new Map(
  VMTier.All.map(tier => [tier.name.toLowerCase(), tier] as const),
)

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\u0000')) {
    throw new Error(`CodeSandbox ${field} is required and must not contain NUL`)
  }
  return value.trim()
}

function boundedHibernationTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 86_400) {
    throw new Error('CodeSandbox hibernationTimeoutSeconds must be an integer from 1 to 86400')
  }
  return value
}

function resolveTier(value: string): VMTier {
  const tier = SDK_TIERS.get(requiredText(value, 'vmTier').toLowerCase())
  if (tier === undefined) {
    throw new Error(`CodeSandbox vmTier must be one of ${[...SDK_TIERS.keys()].join(', ')}`)
  }
  return tier
}

function requiredHex(value: unknown, field: string, exactLength?: number): string {
  const normalized = requiredText(value, field).toLowerCase()
  const pattern = exactLength === undefined
    ? /^[0-9a-f]{40,64}$/
    : new RegExp(`^[0-9a-f]{${exactLength}}$`)
  if (!pattern.test(normalized)) {
    throw new Error(`CodeSandbox ${field} must be a hexadecimal SHA`)
  }
  return normalized
}

function normalizeWorkspaceSeed(seed: CodeSandboxWorkspaceSeed): NormalizedWorkspaceSeed {
  if (!(seed.archive instanceof Uint8Array) || seed.archive.byteLength === 0) {
    throw new Error('CodeSandbox workspaceSeed archive must be non-empty bytes')
  }
  const root = seed.root === undefined ? '/project/sandbox' : requiredText(seed.root, 'workspaceSeed root')
  if (!root.startsWith('/')) throw new Error('CodeSandbox workspaceSeed root must be absolute')
  return Object.freeze({
    archive: seed.archive,
    sourceSha: requiredHex(seed.sourceSha, 'workspaceSeed sourceSha'),
    archiveSha256: requiredHex(seed.archiveSha256, 'workspaceSeed archiveSha256', 64),
    root,
  })
}

function cloneEnvironment(environment: Readonly<Record<string, string>>): Record<string, string> {
  const output: Record<string, string> = {}
  for (const [name, value] of Object.entries(environment)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`CodeSandbox environment name is not a POSIX identifier: ${name}`)
    }
    if (value.includes('\u0000')) throw new Error('CodeSandbox environment value must not contain NUL')
    output[name] = value
  }
  return output
}

/** Quote one literal argv value for the SDK's fixed bash transport. */
function shellQuote(value: string, field: string): string {
  if (value.includes('\u0000')) throw new Error(`CodeSandbox ${field} must not contain NUL`)
  return `'${value.replaceAll("'", "'\\''")}'`
}

function literalCommand(argv: readonly string[], cwd: string): string {
  if (argv.length === 0) throw new Error('CodeSandbox argv must not be empty')
  return `cd ${shellQuote(cwd, 'cwd')} && exec ${argv.map((value, index) => shellQuote(value, `argv[${index}]`)).join(' ')}`
}

function workspaceSeedCommand(seed: NormalizedWorkspaceSeed): string {
  const archivePath = '/tmp/dsh-source.tar.gz'
  const stampPath = `${seed.root}/.dsh-source-sha`
  return [
    `test "$(sha256sum ${shellQuote(archivePath, 'workspaceSeed archive')} | awk '{print $1}')" = ${shellQuote(seed.archiveSha256, 'workspaceSeed archiveSha256')}`,
    `mkdir -p ${shellQuote(seed.root, 'workspaceSeed root')}`,
    `tar -xzf ${shellQuote(archivePath, 'workspaceSeed archive')} -C ${shellQuote(seed.root, 'workspaceSeed root')} --overwrite --no-same-owner`,
    `printf '%s\\n' ${shellQuote(seed.sourceSha, 'workspaceSeed sourceSha')} > ${shellQuote(stampPath, 'workspaceSeed stamp')}`,
    `test "$(cat ${shellQuote(stampPath, 'workspaceSeed stamp')})" = ${shellQuote(seed.sourceSha, 'workspaceSeed sourceSha')}`,
    `rm -f ${shellQuote(archivePath, 'workspaceSeed archive')}`,
  ].join(' && ')
}

function wrapCommand(command: SdkCommand, client: SdkClient, signal?: AbortSignal): CodeSandboxCommand {
  let disposed = false
  let abortPromise: Promise<void> | undefined
  const abort = (): void => {
    abortPromise ??= command.kill()
    // The completion path awaits the same promise and reports a kill failure.
    void abortPromise.catch(() => undefined)
  }
  if (signal?.aborted) {
    abort()
  } else {
    signal?.addEventListener('abort', abort, { once: true })
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    signal?.removeEventListener('abort', abort)
    client.dispose()
  }

  return {
    waitUntilComplete: async () => {
      try {
        const output = await command.waitUntilComplete()
        if (abortPromise !== undefined) await abortPromise
        return output
      } finally {
        dispose()
      }
    },
    kill: async () => {
      try {
        await command.kill()
      } finally {
        dispose()
      }
    },
  }
}

/**
 * CodeSandbox runtime backed by the official `@codesandbox/sdk` package.
 * Sandboxes are private, bounded, and explicitly shut down by the compute
 * adapter after command completion.
 */
export class CodeSandboxSdkRuntime implements CodeSandboxRuntime {
  private readonly sdk: CodeSandboxSdkClient
  private readonly metadata: Pick<CodeSandboxSdkRuntimeOptions, 'title' | 'description' | 'tags'>
  private readonly workspaceSeed: NormalizedWorkspaceSeed | undefined

  constructor(options: CodeSandboxSdkRuntimeOptions = {}) {
    this.metadata = {
      ...(options.title === undefined ? {} : { title: requiredText(options.title, 'title') }),
      ...(options.description === undefined
        ? {}
        : { description: requiredText(options.description, 'description') }),
      ...(options.tags === undefined ? {} : { tags: [...options.tags] }),
    }
    this.workspaceSeed = options.workspaceSeed === undefined
      ? undefined
      : normalizeWorkspaceSeed(options.workspaceSeed)
    if (options.sdk !== undefined) {
      this.sdk = options.sdk
      return
    }

    const apiToken = options.apiToken ?? process.env.CSB_API_KEY
    if (typeof apiToken !== 'string' || apiToken.trim().length === 0 || apiToken.includes('\u0000')) {
      throw new Error('CodeSandbox API token is required via apiToken or CSB_API_KEY')
    }
    this.sdk = new CodeSandbox(apiToken.trim(), options.clientOptions)
  }

  async createSandbox(options: CodeSandboxCreateOptions): Promise<CodeSandboxSdkRuntimeSandbox> {
    const templateId = options.templateId === undefined
      ? undefined
      : requiredText(options.templateId, 'templateId')
    const sandbox = await this.sdk.sandboxes.create({
      ...(templateId === undefined ? {} : { id: templateId }),
      privacy: 'private',
      ...(this.metadata.title === undefined ? {} : { title: this.metadata.title }),
      ...(this.metadata.description === undefined ? {} : { description: this.metadata.description }),
      ...(this.metadata.tags === undefined ? {} : { tags: [...this.metadata.tags] }),
      vmTier: resolveTier(options.vmTier),
      hibernationTimeoutSeconds: boundedHibernationTimeout(options.hibernationTimeoutSeconds),
      automaticWakeupConfig: {
        http: options.automaticWakeupConfig.http,
        websocket: options.automaticWakeupConfig.websocket,
      },
    })
    const managed = this.wrapSandbox(sandbox)
    try {
      if (this.workspaceSeed !== undefined) await managed.seedWorkspace(this.workspaceSeed)
      return managed
    } catch (error) {
      await this.sdk.sandboxes.shutdown(sandbox.id).catch(() => undefined)
      throw error
    }
  }

  async disposeSandbox(sandbox: CodeSandboxSdkRuntimeSandbox): Promise<void> {
    await this.sdk.sandboxes.shutdown(sandbox.id)
  }

  private wrapSandbox(sandbox: SdkSandbox): CodeSandboxSdkRuntimeSandbox {
    return {
      id: sandbox.id,
      seedWorkspace: async (seed) => {
        const normalized = normalizeWorkspaceSeed(seed)
        const client = await sandbox.connect({ permission: 'write' })
        try {
          await client.fs.writeFile('/tmp/dsh-source.tar.gz', normalized.archive)
          await client.commands.run(workspaceSeedCommand(normalized), { cwd: normalized.root })
        } finally {
          client.dispose()
        }
      },
      connect: async (options) => {
        const client = await sandbox.connect({
          permission: 'write',
          env: cloneEnvironment(options.env),
        })
        return this.wrapClient(client)
      },
    }
  }

  private wrapClient(client: SdkClient): CodeSandboxClient {
    return {
      commands: {
        runBackground: async (argv, options) => {
          // The SDK intentionally executes a command through bash -c and its
          // array form joins entries with `&&`; pass one shell-quoted command
          // so the DSH argv remains literal and no task text becomes shell
          // source. The cwd is quoted inside the command because the SDK
          // interpolates its `cwd` option without quoting it.
          const command = await client.commands.runBackground(literalCommand(argv, options.cwd), {
            env: cloneEnvironment(options.env),
          })
          return wrapCommand(command, client, options.signal)
        },
      },
    }
  }
}

/** The runtime-owned sandbox handle exposed to `CodeSandboxComputeBackend`. */
export interface CodeSandboxSdkRuntimeSandbox {
  readonly id: string
  seedWorkspace(seed: CodeSandboxWorkspaceSeed): Promise<void>
  connect(options: Readonly<{
    readonly env: Readonly<Record<string, string>>
  }>): Promise<CodeSandboxClient>
}
