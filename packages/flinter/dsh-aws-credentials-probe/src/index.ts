/**
 * Phase 1 compatibility probe for an AWS Secrets Manager-backed credential
 * provider. The reader is injected so this package cannot contact AWS by
 * accident; production AWS wiring is a later Phase 4 concern.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  CredentialProvider,
  type CredentialInfo,
  type CredentialKey,
  type CredentialRecord,
  type CredentialRecordEntry,
  type CredentialRecordInfo,
  type CredentialRef,
  type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'

export const PHASE_STATUS = 'PHASE1_LOCAL_MOCK_ONLY' as const

/** The four model credential references shared with the alpha profile. */
export const FLINTER_AWS_SECRET_NAMES = Object.freeze({
  ARK_PLAN_API_KEY: 'flinter/dsh-ark-agent-plan',
  MODELFLARE_API_KEY: 'flinter/dsh-modelflare',
  GMI_SERVING_API_KEY: 'flinter/dsh-gmi-serving',
  DEEPSEEK_API_KEY: 'flinter/dsh-deepseek-official',
} as const)

/** AgentBox infrastructure names are a separate input namespace by design. */
export interface AwsCredentialProbeConfig {
  readonly modelSecretNames?: Readonly<Record<string, string>>
  readonly agentBoxSecretNames?: Readonly<Record<string, string>>
  readonly readSecret: (secretName: string) => Promise<string | undefined>
}

/** Safe facts returned by the probe for evidence and tests. */
export interface CredentialProbeDescription extends CredentialInfo {
  readonly secretName?: string
  readonly agentBoxNamespacePresent: boolean
}

/**
 * A read-only CredentialProvider over an injected Secrets Manager-shaped
 * reader. Every resolve/describe calls the reader again: there is no cached
 * secret and no temporary `.credentials.yaml` projection.
 */
export class MockAwsSecretsManagerCredentialProvider extends CredentialProvider {
  private readonly modelSecretNames: Readonly<Record<string, string>>
  private readonly agentBoxSecretNames: Readonly<Record<string, string>>
  private readonly readSecret: (secretName: string) => Promise<string | undefined>

  constructor(ctx: Context, config: AwsCredentialProbeConfig) {
    super(ctx)
    this.modelSecretNames = config.modelSecretNames ?? FLINTER_AWS_SECRET_NAMES
    this.agentBoxSecretNames = config.agentBoxSecretNames ?? {}
    this.readSecret = config.readSecret
  }

  override async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const secretName = this.modelSecretNames[ref]
    if (secretName === undefined) return undefined
    const value = await this.readSecret(secretName)
    if (value === undefined || value.length === 0) return undefined
    return { value, source: `aws-secrets-manager:${secretName}` }
  }

  override async describe(ref: CredentialRef): Promise<CredentialProbeDescription> {
    const secretName = this.modelSecretNames[ref]
    if (secretName === undefined) {
      return { configured: false, writable: false, agentBoxNamespacePresent: Object.keys(this.agentBoxSecretNames).length > 0 }
    }
    const value = await this.readSecret(secretName)
    const configured = value !== undefined && value.length > 0
    return {
      configured,
      ...configured ? { source: `aws-secrets-manager:${secretName}` } : {},
      writable: false,
      secretName,
      agentBoxNamespacePresent: Object.keys(this.agentBoxSecretNames).length > 0,
    }
  }

  override set(_ref: CredentialRef, _value: string): Promise<void> {
    return Promise.reject(new Error('AWS Secrets Manager credential probe is read-only'))
  }

  override unset(_ref: CredentialRef): Promise<void> {
    return Promise.reject(new Error('AWS Secrets Manager credential probe is read-only'))
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

  override modifyRecord(
    _key: CredentialKey,
    _mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    return Promise.reject(new Error('AWS Secrets Manager credential probe is read-only'))
  }

  override deleteRecord(_key: CredentialKey): Promise<void> {
    return Promise.reject(new Error('AWS Secrets Manager credential probe is read-only'))
  }
}
