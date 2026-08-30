/**
 * Public AWS Secrets Manager credential-reference provider for DSH.
 *
 * Settings carry reference names and this provider resolves their values only
 * when an adapter asks through `ctx.credentials`. The source contains no
 * credentials, account identifiers, deployment settings, or secret values.
 * Reads use the standard AWS SDK credential chain. Writes are disabled by
 * default and must be explicitly enabled by a separately reviewed deployment.
 *
 * @module @deepseek-ai/dsh-credentials-aws-secrets-manager
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type {
  CredentialInfo,
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'

/** Plugin configuration. All fields are public routing metadata, never secret values. */
export interface Config {
  /** AWS region; omitted means the standard AWS SDK region chain. */
  region?: string
  /** Optional default prefix for references not present in `secretNames`. */
  secretPrefix?: string
  /** Explicit reference-to-secret-name mapping for deployment-owned names. */
  secretNames?: Readonly<Record<string, string>>
  /** Secret payload shape. JSON is the recommended shape for named references. */
  secretFormat?: 'plain' | 'json'
  /** JSON property carrying the value; defaults to the reference name. */
  jsonField?: string
  /** Writes are opt-in and should remain false for the Phase 1 worker profile. */
  allowWrites?: boolean
}

/** Resolved, validated provider configuration. */
export interface ResolvedSpec {
  readonly region?: string
  readonly secretPrefix: string
  readonly secretNames: Readonly<Record<string, string>>
  readonly secretFormat: 'plain' | 'json'
  readonly jsonField?: string
  readonly allowWrites: boolean
}

/** Apply defaults without contacting AWS or reading a secret. */
export function resolveSpec(config: Config): ResolvedSpec {
  const secretNames = Object.fromEntries(Object.entries(config.secretNames ?? {}).map(([ref, name]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) {
      throw new TypeError(`credentials-aws-secrets-manager: invalid credential reference "${ref}"`)
    }
    if (name.trim() === '' || name.includes('\u0000')) {
      throw new TypeError(`credentials-aws-secrets-manager: secret name for "${ref}" is invalid`)
    }
    return [ref, name]
  }))
  const secretPrefix = config.secretPrefix ?? '/dsh/'
  if (secretPrefix.includes('\u0000')) throw new TypeError('credentials-aws-secrets-manager: secretPrefix is invalid')
  return Object.freeze({
    ...config.region === undefined ? {} : { region: config.region },
    secretPrefix,
    secretNames: Object.freeze(secretNames),
    secretFormat: config.secretFormat ?? 'json',
    ...config.jsonField === undefined ? {} : { jsonField: config.jsonField },
    allowWrites: config.allowWrites ?? false,
  })
}

type SecretPayload = { kind: 'plain'; value: string } | { kind: 'json'; value: Record<string, unknown> }

function parsePayload(text: string | undefined, format: 'plain' | 'json', name: string): SecretPayload | undefined {
  if (text === undefined || text.length === 0) return undefined
  if (format === 'plain') return { kind: 'plain', value: text }
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new TypeError(`credentials-aws-secrets-manager: secret "${name}" must be a JSON object`)
    }
    return { kind: 'json', value: parsed as Record<string, unknown> }
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`credentials-aws-secrets-manager: secret "${name}" is not valid JSON`)
    }
    throw error
  }
}

function selectValue(payload: SecretPayload, ref: CredentialRef, jsonField: string | undefined): string | undefined {
  if (payload.kind === 'plain') return payload.value === '' ? undefined : payload.value
  const value = payload.value[jsonField ?? ref]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isResourceNotFound(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'ResourceNotFoundException'
}

function unsupportedRecords(): Error {
  return new Error('credentials-aws-secrets-manager: record operations are not supported; use credential references')
}

/** AWS-backed implementation of the DSH credential-reference seam. */
export class AwsSecretsManagerCredentialProvider extends CredentialProvider {
  static Config: z<Config> = z.object({
    region: z.string(),
    secretPrefix: z.string().default('/dsh/'),
    secretNames: z.dict(z.string()).default({}),
    secretFormat: z.union(['plain', 'json']).default('json'),
    jsonField: z.string(),
    allowWrites: z.boolean().default(false),
  })

  private readonly spec: ResolvedSpec
  private readonly client: SecretsManagerClient

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    this.spec = resolveSpec(config)
    this.client = new SecretsManagerClient({
      ...this.spec.region === undefined ? {} : { region: this.spec.region },
    })
  }

  private secretName(ref: CredentialRef): string {
    return this.spec.secretNames[ref] ?? `${this.spec.secretPrefix}${ref}`
  }

  private async fetch(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const name = this.secretName(ref)
    let response
    try {
      response = await this.client.send(new GetSecretValueCommand({ SecretId: name }))
    } catch (error) {
      if (isResourceNotFound(error)) return undefined
      throw error
    }
    const payload = parsePayload(response.SecretString, this.spec.secretFormat, name)
    if (payload === undefined) return undefined
    const value = selectValue(payload, ref, this.spec.jsonField)
    return value === undefined ? undefined : { value, source: 'aws-secrets-manager' }
  }

  override async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    return this.fetch(ref)
  }

  override async describe(ref: CredentialRef): Promise<CredentialInfo> {
    const name = this.secretName(ref)
    try {
      await this.client.send(new DescribeSecretCommand({ SecretId: name }))
      return { configured: true, source: 'aws-secrets-manager', writable: this.spec.allowWrites }
    } catch (error) {
      if (isResourceNotFound(error)) return { configured: false, writable: this.spec.allowWrites }
      throw error
    }
  }

  override async set(ref: CredentialRef, value: string): Promise<void> {
    if (!this.spec.allowWrites) throw new Error('credentials-aws-secrets-manager: set is disabled for this read-only profile')
    if (value.length === 0) throw new Error(`credentials-aws-secrets-manager: empty value cannot be stored for "${ref}"`)
    const name = this.secretName(ref)
    const payload = this.spec.secretFormat === 'plain'
      ? value
      : JSON.stringify({ [this.spec.jsonField ?? ref]: value })
    try {
      await this.client.send(new PutSecretValueCommand({ SecretId: name, SecretString: payload }))
    } catch (error) {
      if (!isResourceNotFound(error)) throw error
      await this.client.send(new CreateSecretCommand({ Name: name, SecretString: payload }))
    }
    this.notifyUpdated(ref)
  }

  override async unset(ref: CredentialRef): Promise<void> {
    if (!this.spec.allowWrites) throw new Error('credentials-aws-secrets-manager: unset is disabled for this read-only profile')
    try {
      await this.client.send(new DeleteSecretCommand({
        SecretId: this.secretName(ref),
        ForceDeleteWithoutRecovery: true,
      }))
      this.notifyUpdated(ref)
    } catch (error) {
      if (!isResourceNotFound(error)) throw error
    }
  }

  /** The AWS adapter serves reference values only; record state remains local to its owner. */
  override readRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.resolve(undefined)
  }

  override describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> {
    return Promise.resolve({ configured: false, writable: false })
  }

  override listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([])
  }

  override modifyRecord(
    _key: CredentialKey,
    _mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    return Promise.reject(unsupportedRecords())
  }

  override deleteRecord(_key: CredentialKey): Promise<void> {
    return Promise.reject(unsupportedRecords())
  }

  * [Service.init](): Generator<() => void, void, void> {
    yield () => this.client.destroy()
  }
}

export default AwsSecretsManagerCredentialProvider
