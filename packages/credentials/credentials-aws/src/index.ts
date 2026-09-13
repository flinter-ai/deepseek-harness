/**
 * Read-only AWS Secrets Manager provider for the credential-reference seam.
 *
 * The configured secret contains a JSON object whose keys are CredentialRef
 * names and whose values are non-empty secret strings. The provider resolves
 * the inherited process environment first, then the remote snapshot. It never
 * writes the secret, returns values from describe(), or persists a copy.
 *
 * @module @deepseek-ai/dsh-credentials-aws
 */

import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { Context, Service } from '@deepseek-ai/cordis'
import { CredentialProvider, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type {
  CredentialInfo,
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'

/** AWS source label returned by resolve/describe; it contains no secret data. */
export const AWS_SECRETS_MANAGER_SOURCE = 'aws-secrets-manager' as const

/** Default cache lifetime; the next request after expiry observes rotation. */
export const DEFAULT_REFRESH_MS = 60_000

/** Safe subset returned by the AWS SDK reader seam. */
export interface SecretValuePayload {
  readonly secretString?: string
  readonly secretBinary?: unknown
}

/** Injectable reader used by tests and hosts that already own an AWS client. */
export type SecretsManagerReader = (secretId: string) => Promise<SecretValuePayload>

/** Runtime configuration. `secretId` is an identifier, never a secret value. */
export interface Config {
  /** Secrets Manager secret identifier containing the JSON credential map. */
  secretId: string
  /** Optional AWS region; otherwise the SDK default provider chain selects it. */
  region?: string
  /** Refresh interval in milliseconds; zero disables caching. */
  refreshMs?: number
}

/** Parsed remote credential snapshot kept only in memory. */
type CredentialSnapshot = ReadonlyMap<string, string>

/** Build the production SDK reader and return its lifecycle closer. */
function sdkReader(region: string | undefined): {
  reader: SecretsManagerReader
  close(): void
} {
  const client = new SecretsManagerClient(region === undefined ? {} : { region })
  return {
    reader: async (secretId) => {
      const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }))
      return {
        ...(result.SecretString === undefined ? {} : { secretString: result.SecretString }),
        ...(result.SecretBinary === undefined ? {} : { secretBinary: result.SecretBinary }),
      }
    },
    close: () => { client.destroy() },
  }
}

function safeErrorCode(error: unknown): string {
  const code = error !== null && typeof error === 'object'
    ? (error as { name?: unknown; code?: unknown }).name ?? (error as { code?: unknown }).code
    : undefined
  return typeof code === 'string' && code.length > 0 ? code : 'request-failed'
}

/** Parse and validate the configured JSON map without echoing any value. */
export function parseSecretValue(payload: SecretValuePayload): CredentialSnapshot {
  if (payload.secretString === undefined || payload.secretString.length === 0) {
    throw new Error('credentials-aws: Secrets Manager returned no non-empty SecretString')
  }
  if (payload.secretBinary !== undefined) {
    throw new Error('credentials-aws: SecretBinary is unsupported; use a JSON SecretString')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(payload.secretString)
  } catch {
    throw new Error('credentials-aws: Secrets Manager SecretString is not valid JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('credentials-aws: SecretString must be a JSON object')
  }
  const values = new Map<string, string>()
  for (const [name, value] of Object.entries(parsed)) {
    if (!isCredentialRefName(name)) {
      throw new Error(`credentials-aws: invalid credential reference "${name}" in SecretString`)
    }
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`credentials-aws: credential reference "${name}" must have a non-empty string value`)
    }
    values.set(name, value)
  }
  return values
}

/** Native DSH read-only Secrets Manager credential service. */
export class AwsSecretsManagerCredentialProvider extends CredentialProvider {
  static Config: z<Config> = z.object({
    secretId: z.string(),
    region: z.string().default(''),
    refreshMs: z.natural().default(DEFAULT_REFRESH_MS),
  })

  private readonly secretId: string
  private readonly region: string | undefined
  private readonly refreshMs: number
  private readonly reader: SecretsManagerReader
  private readonly closeReader: () => void
  private snapshot: { values: CredentialSnapshot; expiresAt: number } | undefined
  private loading: Promise<CredentialSnapshot> | undefined
  private closed = false

  /**
   * The optional reader is a test/host seam; production uses the AWS SDK's
   * default credential chain and instance role. It is intentionally not part
   * of the serialized Config schema.
   */
  constructor(ctx: Context, config: Config, reader?: SecretsManagerReader) {
    super(ctx)
    this.secretId = config.secretId
    this.region = config.region === '' ? undefined : config.region
    this.refreshMs = config.refreshMs ?? DEFAULT_REFRESH_MS
    if (!Number.isInteger(this.refreshMs) || this.refreshMs < 0) {
      throw new TypeError('credentials-aws: refreshMs must be a non-negative integer')
    }
    if (reader === undefined) {
      const sdk = sdkReader(this.region)
      this.reader = sdk.reader
      this.closeReader = sdk.close
    } else {
      this.reader = reader
      this.closeReader = () => {}
    }
  }

  async* [Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    yield () => {
      this.closed = true
      this.snapshot = undefined
      this.closeReader()
    }
  }

  override async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const inherited = this.inherited(ref)
    if (inherited !== undefined) return { value: inherited, source: 'env' }
    const value = (await this.values()).get(ref)
    return value === undefined ? undefined : { value, source: AWS_SECRETS_MANAGER_SOURCE }
  }

  override async describe(ref: CredentialRef): Promise<CredentialInfo> {
    const inherited = this.inherited(ref)
    if (inherited !== undefined) return { configured: true, source: 'env', writable: false }
    const configured = (await this.values()).has(ref)
    return configured
      ? { configured: true, source: AWS_SECRETS_MANAGER_SOURCE, writable: false }
      : { configured: false, writable: false }
  }

  override async set(ref: CredentialRef, _value: string): Promise<void> {
    throw this.readOnly('set', ref)
  }

  override async unset(ref: CredentialRef): Promise<void> {
    throw this.readOnly('unset', ref)
  }

  override readRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.resolve(undefined)
  }

  override describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> {
    return Promise.resolve({ configured: false, writable: false })
  }

  override listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([])
  }

  override async modifyRecord(
    key: CredentialKey,
    _mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    throw this.readOnly('modify record', key)
  }

  override async deleteRecord(key: CredentialKey): Promise<void> {
    throw this.readOnly('delete record', key)
  }

  /** Resolve the process layer using the same launch-environment convention as credentials-local. */
  private inherited(ref: CredentialRef): string | undefined {
    const entry = launchEnvironmentOf(this.ctx).getFrom(ref, ['process'])
    return entry !== undefined && entry.value.length > 0 ? entry.value : undefined
  }

  /** Load one bounded in-memory snapshot, coalescing concurrent reads. */
  private async values(): Promise<CredentialSnapshot> {
    if (this.closed) throw new Error('credentials-aws: provider is disposed')
    if (this.refreshMs > 0 && this.snapshot !== undefined && Date.now() < this.snapshot.expiresAt) {
      return this.snapshot.values
    }
    if (this.loading !== undefined) return this.loading
    this.loading = this.load()
    try {
      return await this.loading
    } finally {
      this.loading = undefined
    }
  }

  private async load(): Promise<CredentialSnapshot> {
    let payload: SecretValuePayload
    try {
      payload = await this.reader(this.secretId)
    } catch (error) {
      throw new Error(`credentials-aws: Secrets Manager read failed (${safeErrorCode(error)})`)
    }
    const values = parseSecretValue(payload)
    if (this.refreshMs > 0) this.snapshot = { values, expiresAt: Date.now() + this.refreshMs }
    return values
  }

  private readOnly(operation: string, subject: string): Error {
    return new Error(`credentials-aws: ${operation} is disabled for the read-only AWS provider ("${subject}")`)
  }
}

export default AwsSecretsManagerCredentialProvider
