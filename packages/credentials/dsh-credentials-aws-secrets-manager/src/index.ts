/**
 * AWS Secrets Manager credentials provider for the DeepSeek Harness.
 *
 * Each {@link CredentialRef} maps to one Secrets Manager secret whose name is
 * `<prefix><ref>`. The secret payload may be a plain string or a JSON object;
 * when it is JSON, `jsonField` selects the property that carries the value
 * (defaulting to the reference name itself).
 *
 * Credentials resolve through the standard AWS credential chain (environment
 * variables, `AWS_PROFILE`, ECS task roles, web identity), so a container
 * running in AWS needs no stored key. `region` and `profile` are optional
 * overrides for the default chain.
 *
 * Writes (`set` / `unset`) create, update, or delete the corresponding
 * Secrets Manager secret. A secret that does not exist is reported as
 * unconfigured; an empty payload is treated as absent.
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
import type { CredentialInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'

/** Plugin config: AWS connection and secret-naming behavior. */
export interface Config {
  /** AWS region; defaults to `AWS_REGION` / `AWS_DEFAULT_REGION` / the SDK default. */
  region?: string
  /** AWS profile; defaults to `AWS_PROFILE` / the default credential chain. */
  profile?: string
  /** Prefix prepended to every credential reference to form the secret name. */
  secretPrefix?: string
  /** Payload shape: `plain` for a raw string, `json` for a JSON object. */
  secretFormat?: 'plain' | 'json'
  /** JSON property that carries the secret value when `secretFormat` is `json`. */
  jsonField?: string
}

/** Fully resolved provider parameters; defaulting happens here, never inline. */
interface ResolvedSpec {
  region?: string
  profile?: string
  secretPrefix: string
  secretFormat: 'plain' | 'json'
  jsonField?: string
}

/**
 * Resolve the runtime spec from plugin config.
 * @param config - raw plugin config.
 * @returns the resolved AWS connection and naming behavior.
 */
export function resolveSpec(config: Config): ResolvedSpec {
  return {
    ...config.region === undefined ? {} : { region: config.region },
    ...config.profile === undefined ? {} : { profile: config.profile },
    secretPrefix: config.secretPrefix ?? '/dsh/',
    secretFormat: config.secretFormat ?? 'json',
    ...config.jsonField === undefined ? {} : { jsonField: config.jsonField },
  }
}

/** One parsed secret payload, ready for field selection. */
type SecretPayload = { kind: 'plain'; value: string } | { kind: 'json'; value: Record<string, unknown> }

/**
 * Parse a Secrets Manager payload. Empty payloads are absent; invalid JSON
 * under `json` format fails loud because the caller asked for structure.
 * @param text - the raw SecretString, or `undefined` for a binary/absent secret.
 * @param format - the configured payload shape.
 * @param name - secret name, quoted in errors.
 * @returns the parsed payload, or `undefined` while absent.
 */
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

/**
 * Select the credential value from a parsed payload. The JSON field name
 * defaults to the reference itself, so `{"DEEPSEEK_API_KEY": "…"}` resolves
 * for ref `DEEPSEEK_API_KEY` without extra configuration.
 * @param payload - the parsed secret payload.
 * @param ref - the credential reference being resolved.
 * @param jsonField - the configured JSON field override, if any.
 * @returns the non-empty value, or `undefined` while absent.
 */
function selectValue(payload: SecretPayload, ref: CredentialRef, jsonField: string | undefined): string | undefined {
  if (payload.kind === 'plain') return payload.value
  const field = jsonField ?? ref
  const value = payload.value[field]
  if (typeof value !== 'string' || value.length === 0) return undefined
  return value
}

/** AWS Secrets Manager credentials provider. */
export class AwsSecretsManagerCredentialProvider extends CredentialProvider {
  static Config: z<Config> = z.object({
    region: z.string(),
    profile: z.string(),
    secretPrefix: z.string().default('/dsh/'),
    secretFormat: z.union(['plain', 'json']).default('json'),
    jsonField: z.string(),
  })

  private readonly spec: ResolvedSpec
  private readonly client: SecretsManagerClient

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    this.spec = resolveSpec(config)
    this.client = new SecretsManagerClient({
      ...this.spec.region === undefined ? {} : { region: this.spec.region },
      ...this.spec.profile === undefined ? {} : { profile: this.spec.profile },
    })
  }

  /** The Secrets Manager name for one credential reference. */
  private secretName(ref: CredentialRef): string {
    return `${this.spec.secretPrefix}${ref}`
  }

  /** Fetch and parse one secret, returning `undefined` while absent. */
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
    if (value === undefined) return undefined
    return { value, source: 'aws-secrets-manager' }
  }

  override async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    return this.fetch(ref)
  }

  override async describe(ref: CredentialRef): Promise<CredentialInfo> {
    const name = this.secretName(ref)
    try {
      await this.client.send(new DescribeSecretCommand({ SecretId: name }))
      return { configured: true, source: 'aws-secrets-manager', writable: true }
    } catch (error) {
      if (isResourceNotFound(error)) return { configured: false, writable: true }
      throw error
    }
  }

  override async set(ref: CredentialRef, value: string): Promise<void> {
    if (value.length === 0) {
      throw new Error(`credentials-aws-secrets-manager: an empty value cannot be stored for "${ref}"; use unset`)
    }
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
    const name = this.secretName(ref)
    try {
      await this.client.send(new DeleteSecretCommand({ SecretId: name, ForceDeleteWithoutRecovery: true }))
      this.notifyUpdated(ref)
    } catch (error) {
      if (!isResourceNotFound(error)) throw error
    }
  }

  async* [Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    yield async () => {
      this.client.destroy()
    }
  }
}

/** Whether an AWS SDK error means the secret does not exist. */
function isResourceNotFound(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'ResourceNotFoundException'
}

export default AwsSecretsManagerCredentialProvider
