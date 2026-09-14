/**
 * Optional native DSH contract plugin for Relace Search and Instant Apply.
 *
 * This package deliberately owns protocol construction and host callbacks,
 * not filesystem or process authority. A host composes its provider profiles
 * into `llm-pi-ai`, then loads this plugin when it wants the Relace helpers.
 * That keeps the feature portable across the local harness, EC2, and another
 * compute backend without duplicating provider transport code.
 *
 * @module @deepseek-ai/dsh-relace
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, ToolSchema } from '@deepseek-ai/dsh-llm'
import type { PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'

export const name = 'relace'
export const inject: readonly string[] = []

/** OpenRouter model id for Relace's agentic codebase search. */
export const RELACE_SEARCH_MODEL = 'relace/relace-search' as const
/** OpenRouter model id for Relace's Instant Apply-3 operation. */
export const RELACE_APPLY_MODEL = 'relace/relace-apply-3' as const
/** OpenRouter-compatible API base used by both Relace routes. */
export const RELACE_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1' as const
/** DSH provider key for the Relace Search route. */
export const RELACE_SEARCH_PROVIDER = 'relace-search' as const
/** DSH provider key for the Relace Apply-3 route. */
export const RELACE_APPLY_PROVIDER = 'relace-apply-3' as const
/** Maximum serialized prompt size accepted by the Apply-3 formatter. */
export const RELACE_APPLY_MAX_INPUT_CHARS = 512_000

/** The exact tool names accepted by the Relace Search model. */
export type RelaceSearchToolName =
  | 'view_file'
  | 'view_directory'
  | 'grep_search'
  | 'bash'
  | 'report_back'

/** Provider-facing strict function schema for one Relace Search tool. */
export interface RelaceSearchToolSchema extends ToolSchema {
  readonly name: RelaceSearchToolName
  readonly strict: true
}

const viewFile: RelaceSearchToolSchema = {
  name: 'view_file',
  description: 'Read a bounded line range from an existing file. Paths and range limits are enforced by the host.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      view_range: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 },
    },
    required: ['path', 'view_range'],
    additionalProperties: false,
  },
}

const viewDirectory: RelaceSearchToolSchema = {
  name: 'view_directory',
  description: 'List a bounded directory tree. The host decides the workspace root and output cap.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      include_hidden: { type: 'boolean' },
    },
    required: ['path', 'include_hidden'],
    additionalProperties: false,
  },
}

const grepSearch: RelaceSearchToolSchema = {
  name: 'grep_search',
  description: 'Search text with the host-controlled read-only search implementation.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      case_sensitive: { type: 'boolean' },
      exclude_pattern: { type: ['string', 'null'] },
      include_pattern: { type: ['string', 'null'] },
    },
    required: ['query', 'case_sensitive', 'exclude_pattern', 'include_pattern'],
    additionalProperties: false,
  },
}

const bash: RelaceSearchToolSchema = {
  name: 'bash',
  description: 'Run one host-allowlisted, bounded command. The host must keep this boundary read-only.',
  strict: true,
  parameters: {
    type: 'object',
    properties: { command: { type: 'string' } },
    required: ['command'],
    additionalProperties: false,
  },
}

const reportBack: RelaceSearchToolSchema = {
  name: 'report_back',
  description: 'Report the relevant files and line ranges after the codebase is understood.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      explanation: { type: 'string' },
      files: {
        type: 'object',
        additionalProperties: {
          type: 'array',
          items: {
            type: 'array',
            minItems: 2,
            maxItems: 2,
            prefixItems: [{ type: 'integer' }, { type: 'integer' }],
          },
        },
      },
    },
    required: ['explanation', 'files'],
    additionalProperties: false,
  },
}

/** The strict host-tool schemas required by Relace Search. */
export const RELACE_SEARCH_TOOLS: readonly RelaceSearchToolSchema[] = Object.freeze([
  viewFile,
  viewDirectory,
  grepSearch,
  bash,
  reportBack,
])

/**
 * Return detached schemas so request callers cannot mutate the plugin constants.
 * @returns mutable copies of the provider-facing tool schemas.
 */
export function relaceSearchToolSchemas(): ToolSchema[] {
  return RELACE_SEARCH_TOOLS.map(tool => ({
    ...tool,
    parameters: structuredClone(tool.parameters),
  }))
}

/** Host-owned implementations bound to the five Relace Search tool names. */
export interface RelaceSearchToolHandlers {
  viewFile(args: { readonly path: string; readonly view_range: readonly [number, number] }, signal?: AbortSignal): Promise<unknown>
  viewDirectory(args: { readonly path: string; readonly include_hidden: boolean }, signal?: AbortSignal): Promise<unknown>
  grepSearch(args: {
    readonly query: string
    readonly case_sensitive: boolean
    readonly exclude_pattern: string | null
    readonly include_pattern: string | null
  }, signal?: AbortSignal): Promise<unknown>
  /** The host must apply its own command allowlist and sandbox policy. */
  bash(args: { readonly command: string }, signal?: AbortSignal): Promise<unknown>
}

/** Validated report-back payload returned by Relace Search. */
export interface RelaceSearchReport {
  readonly explanation: string
  readonly files: Readonly<Record<string, readonly (readonly [number, number])[]>>
}

/** Policy-bound bridge between Relace Search tool calls and host callbacks. */
export interface RelaceSearchToolBridge {
  readonly schemas: readonly ToolSchema[]
  execute(name: RelaceSearchToolName, args: unknown, signal?: AbortSignal): Promise<unknown>
  report(): RelaceSearchReport | undefined
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\u0000')) {
    throw new Error(`relace ${field} is required and must not contain NUL`)
  }
  return value
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`relace ${field} must be boolean`)
  return value
}

function requiredRange(value: unknown): readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(item => Number.isInteger(item))) {
    throw new Error('relace view_range must contain exactly two integers')
  }
  return [value[0] as number, value[1] as number]
}

function nullableString(value: unknown, field: string): string | null {
  return value === null ? null : requiredString(value, field)
}

function parseReport(value: unknown): RelaceSearchReport {
  const record = objectRecord(value, 'relace report must be an object')
  const filesRecord = objectRecord(record.files, 'relace report files must be an object')
  const files: Record<string, readonly (readonly [number, number])[]> = {}
  for (const [path, ranges] of Object.entries(filesRecord)) {
    if (path.trim().length === 0 || path.includes('\u0000') || !Array.isArray(ranges)) {
      throw new Error('relace report files must map paths to line ranges')
    }
    files[path] = Object.freeze(ranges.map(requiredRange))
  }
  return Object.freeze({
    explanation: requiredString(record.explanation, 'explanation'),
    files: Object.freeze(files),
  })
}

/**
 * Bind the exact Relace tool names to host-owned, policy-checked operations.
 * @param handlers - Host callbacks for the read-only search tool operations.
 * @returns a bridge that validates arguments and retains the final report.
 */
export function createRelaceSearchToolBridge(handlers: RelaceSearchToolHandlers): RelaceSearchToolBridge {
  let finalReport: RelaceSearchReport | undefined
  return {
    schemas: Object.freeze(relaceSearchToolSchemas()),
    async execute(name, args, signal) {
      const record = objectRecord(args, 'relace tool arguments must be an object')
      switch (name) {
        case 'view_file':
          return handlers.viewFile({ path: requiredString(record.path, 'path'), view_range: requiredRange(record.view_range) }, signal)
        case 'view_directory':
          return handlers.viewDirectory({ path: requiredString(record.path, 'path'), include_hidden: requiredBoolean(record.include_hidden, 'include_hidden') }, signal)
        case 'grep_search':
          return handlers.grepSearch({
            query: requiredString(record.query, 'query'),
            case_sensitive: requiredBoolean(record.case_sensitive, 'case_sensitive'),
            exclude_pattern: nullableString(record.exclude_pattern, 'exclude_pattern'),
            include_pattern: nullableString(record.include_pattern, 'include_pattern'),
          }, signal)
        case 'bash':
          return handlers.bash({ command: requiredString(record.command, 'command') }, signal)
        case 'report_back':
          finalReport = parseReport(record)
          return finalReport
      }
    },
    report: () => finalReport,
  }
}

/** Credential references used to resolve the two OpenRouter-backed routes. */
export interface RelaceProviderCredentialRefs {
  /** Environment or credential reference used by Relace Search. */
  readonly search: string
  /** Environment or credential reference used by Relace Apply. */
  readonly apply: string
}

/** Default host credential references for both Relace routes. */
export const RELACE_DEFAULT_CREDENTIAL_REFS = Object.freeze({
  search: 'OPENROUTER_API_KEY',
  apply: 'OPENROUTER_API_KEY',
} satisfies RelaceProviderCredentialRefs)

/**
 * Build provider rows consumed by the existing generic `llm-pi-ai` plugin.
 * @param credentialRefs - Environment or credential names for each route.
 * @returns provider profiles for Relace Search and Apply-3.
 */
export function buildRelaceProviderProfiles(
  credentialRefs: Partial<RelaceProviderCredentialRefs> = {},
): Readonly<Record<string, PiAiProviderProfile>> {
  const searchApiKeyEnv = credentialRefs.search ?? RELACE_DEFAULT_CREDENTIAL_REFS.search
  const applyApiKeyEnv = credentialRefs.apply ?? RELACE_DEFAULT_CREDENTIAL_REFS.apply
  return Object.freeze({
    [RELACE_SEARCH_PROVIDER]: {
      displayName: 'Relace Search (OpenRouter)',
      apiKeyEnv: searchApiKeyEnv,
      api: 'openai-completions',
      baseURL: RELACE_OPENROUTER_BASE_URL,
      defaultContextWindow: 262_144,
      defaultMaxTokens: 8_192,
      compat: { supportsStrictMode: true },
      models: [{ id: RELACE_SEARCH_MODEL, name: 'Relace Search', contextWindow: 262_144, maxTokens: 8_192 }],
    },
    [RELACE_APPLY_PROVIDER]: {
      displayName: 'Relace Apply 3 (OpenRouter)',
      apiKeyEnv: applyApiKeyEnv,
      api: 'openai-completions',
      baseURL: RELACE_OPENROUTER_BASE_URL,
      defaultContextWindow: 262_144,
      defaultMaxTokens: 32_768,
      models: [{ id: RELACE_APPLY_MODEL, name: 'Relace Apply 3', contextWindow: 262_144, maxTokens: 32_768 }],
    },
  } satisfies Readonly<Record<string, PiAiProviderProfile>>)
}

/** System instruction that constrains the Relace Search agent to host tools. */
export const RELACE_SEARCH_SYSTEM_PROMPT = [
  'You are an AI agent whose job is to explore a code base with the provided tools and thoroughly understand the problem.',
  'Use the tools to inspect the codebase, then call report_back when the relevant files and reasoning are clear.',
  'The host enforces workspace roots, output limits, and a read-only command policy.',
].join('\n')

/**
 * Build the tagged user request expected by Relace Search.
 * @param input - Codebase location and user query to encode.
 * @returns the tagged Relace Search user prompt.
 */
export function buildRelaceSearchUserPrompt(input: { readonly codebase: string; readonly userPrompt: string }): string {
  const codebase = requiredString(input.codebase, 'codebase')
  const userPrompt = requiredString(input.userPrompt, 'userPrompt')
  if (userPrompt.toLowerCase().includes('</user_query>')) throw new Error('relace userPrompt must not contain a closing user_query tag')
  return [
    `I have uploaded a code repository in the ${codebase} directory.`,
    '',
    'Now consider the following user query:',
    '',
    '<user_query>',
    userPrompt,
    '</user_query>',
    'You need to resolve the <user_query>.',
  ].join('\n')
}

/**
 * Build a DSH model request for Relace Search and its strict tools.
 * @param input - Codebase location and user query to send.
 * @returns model-generation options for the Relace Search route.
 */
export function buildRelaceSearchGenerateOptions(input: { readonly codebase: string; readonly userPrompt: string }): GenerateOptions {
  return {
    provider: RELACE_SEARCH_PROVIDER,
    model: RELACE_SEARCH_MODEL,
    system: RELACE_SEARCH_SYSTEM_PROMPT,
    messages: [createUserMessage({
      content: [{ type: 'text', text: buildRelaceSearchUserPrompt(input) }],
      source: { kind: 'plugin', plugin: name },
    })],
    tools: relaceSearchToolSchemas(),
    maxTokens: 8_192,
  }
}

function taggedValue(value: unknown, field: string, tag: string, singleLine = false): string {
  const normalized = requiredString(value, field)
  if (normalized.toLowerCase().includes(`</${tag.toLowerCase()}>`)) throw new Error(`relace ${field} must not contain a closing ${tag} tag`)
  if (singleLine && /[\r\n]/u.test(normalized)) throw new Error(`relace ${field} must be a single line`)
  return normalized
}

/**
 * Format the documented Apply-3 input without writing the result anywhere.
 * @param input - Optional instruction, original code, and requested update.
 * @returns the bounded tagged Apply-3 prompt.
 */
export function formatRelaceApplyPrompt(input: {
  readonly instruction?: string
  readonly initialCode: string
  readonly editSnippet: string
}): string {
  const instruction = input.instruction === undefined ? undefined : taggedValue(input.instruction, 'instruction', 'instruction', true)
  const result = [
    ...(instruction === undefined ? [] : [`<instruction>${instruction}</instruction>`]),
    `<code>${taggedValue(input.initialCode, 'initialCode', 'code')}</code>`,
    `<update>${taggedValue(input.editSnippet, 'editSnippet', 'update')}</update>`,
  ].join('\n')
  if (result.length > RELACE_APPLY_MAX_INPUT_CHARS) throw new Error(`relace apply prompt exceeds ${RELACE_APPLY_MAX_INPUT_CHARS} characters`)
  return result
}

/**
 * Build a DSH model request for Relace Instant Apply-3.
 * @param input - Optional instruction, original code, and requested update.
 * @returns model-generation options for the Relace Apply-3 route.
 */
export function buildRelaceApplyGenerateOptions(input: {
  readonly instruction?: string
  readonly initialCode: string
  readonly editSnippet: string
}): GenerateOptions {
  return {
    provider: RELACE_APPLY_PROVIDER,
    model: RELACE_APPLY_MODEL,
    messages: [createUserMessage({
      content: [{ type: 'text', text: formatRelaceApplyPrompt(input) }],
      source: { kind: 'plugin', plugin: name },
    })],
    maxTokens: 32_768,
  }
}

/** Normalized merged-code result accepted from an Apply-3 response. */
export interface RelaceApplyResult {
  readonly mergedCode: string
  readonly usage?: Readonly<Record<string, unknown>>
}

/**
 * Extract merged code from either the native or OpenAI-compatible response shape.
 * @param payload - Untrusted provider response to validate.
 * @returns normalized merged code and optional usage metadata.
 */
export function parseRelaceApplyResponse(payload: unknown): RelaceApplyResult {
  const record = objectRecord(payload, 'relace apply response must be an object')
  if (typeof record.mergedCode === 'string') return {
    mergedCode: record.mergedCode,
    ...(record.usage !== undefined && record.usage !== null && typeof record.usage === 'object'
      ? { usage: record.usage as Readonly<Record<string, unknown>> }
      : {}),
  }
  const choices = record.choices
  const first = Array.isArray(choices) ? choices[0] : undefined
  const content = first !== null && typeof first === 'object'
    ? (first as { message?: { content?: unknown } }).message?.content
    : undefined
  if (typeof content !== 'string') throw new Error('relace apply response did not contain merged code')
  return {
    mergedCode: content,
    ...(record.usage !== undefined && record.usage !== null && typeof record.usage === 'object'
      ? { usage: record.usage as Readonly<Record<string, unknown>> }
      : {}),
  }
}

/** Configuration for the optional Relace provider-helper plugin. */
export interface Config {
  /** Credential references for the Search and Apply provider routes. */
  credentialRefs?: Partial<RelaceProviderCredentialRefs>
}

export const Config = z.object({
  credentialRefs: z.object({
    search: z.string().default(RELACE_DEFAULT_CREDENTIAL_REFS.search),
    apply: z.string().default(RELACE_DEFAULT_CREDENTIAL_REFS.apply),
  }).default(RELACE_DEFAULT_CREDENTIAL_REFS),
}) as unknown as z<Config>

/** Public runtime surface exposed by the optional Relace plugin. */
export interface RelaceRuntime {
  readonly providerProfiles: Readonly<Record<string, PiAiProviderProfile>>
  readonly searchTools: readonly RelaceSearchToolSchema[]
  /** Build a model request for Relace Search.
   * @param input - Codebase and user prompt to search.
   * @returns The provider-facing generation request.
   */
  buildSearchGenerateOptions(input: { readonly codebase: string; readonly userPrompt: string }): GenerateOptions
  /** Build a model request for Relace Apply.
   * @param input - Initial code, edit snippet, and optional instruction.
   * @returns The provider-facing generation request.
   */
  buildApplyGenerateOptions(input: {
    readonly instruction?: string
    readonly initialCode: string
    readonly editSnippet: string
  }): GenerateOptions
  /** Create the host-owned bridge for invoking Relace Search tools.
   * @param handlers - Host callbacks for Search tool execution.
   * @returns A tool bridge with the public Search schemas.
   */
  createSearchToolBridge(handlers: RelaceSearchToolHandlers): RelaceSearchToolBridge
}

/**
 * Create a pure Relace runtime surface from host-owned credential references.
 * @param config - Credential references for the optional provider routes.
 * @returns the provider profiles, tool schemas, prompt builders, and bridge factory.
 */
export function createRelaceRuntime(config: Config = {}): RelaceRuntime {
  const providerProfiles = buildRelaceProviderProfiles(config.credentialRefs)
  return Object.freeze({
    providerProfiles,
    searchTools: RELACE_SEARCH_TOOLS,
    buildSearchGenerateOptions: buildRelaceSearchGenerateOptions,
    buildApplyGenerateOptions: buildRelaceApplyGenerateOptions,
    createSearchToolBridge: createRelaceSearchToolBridge,
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    relace: RelaceRuntime
  }
}

/** Provide the optional Relace contract without mutating llm-pi-ai routes. */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.provide('relace', createRelaceRuntime(config))
}
