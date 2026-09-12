/** Harness adapters for Relace search and Instant Apply over OpenRouter. */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, ToolSchema } from '@deepseek-ai/dsh-llm'
import type { PiAiProviderProfile } from './config.ts'

/** OpenRouter model identifiers requested by the Relace integration. */
export const RELACE_SEARCH_MODEL = 'relace/relace-search' as const
export const RELACE_APPLY_MODEL = 'relace/relace-apply-3' as const
export const RELACE_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1' as const
export const RELACE_SEARCH_PROVIDER = 'relace-search' as const
export const RELACE_APPLY_PROVIDER = 'relace-apply-3' as const
export const RELACE_SEARCH_MAX_TURNS = 5
/** Character guard kept below the documented 128k-token Apply-3 input limit. */
export const RELACE_APPLY_MAX_INPUT_CHARS = 512_000

/** The five exact model-facing search tools required by Relace Agent Search. */
export type RelaceSearchToolName =
  | 'view_file'
  | 'view_directory'
  | 'grep_search'
  | 'bash'
  | 'report_back'

/** Strict OpenAI function-tool schema used by the Relace search model. */
export interface RelaceSearchToolSchema extends ToolSchema {
  readonly name: RelaceSearchToolName
  readonly strict: true
}

const viewFile: RelaceSearchToolSchema = Object.freeze({
  name: 'view_file',
  description: 'Tool for viewing/exploring the contents of existing files\n\n Line numbers are included in the output, indexing at 1. If the output does not include the end of the file, it will be noted after the final output line.\n\n Example (viewing the first 2 lines of a file):\n 1   def my_function():\n 2       print("Hello, World!")\n... rest of file truncated ...',
  strict: true,
  parameters: Object.freeze({
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to a file, e.g. `/repo/file.py`.' },
      view_range: {
        type: 'array',
        items: { type: 'integer' },
        default: [1, 100],
        description: 'Range of file lines to view. If not specified, the first 100 lines of the file are shown. If provided, the file will be shown in the indicated line number range, e.g. [11, 12] will show lines 11 and 12. Indexing at 1 to start. Setting `[start_line, -1]` shows all lines from `start_line` to the end of the file.',
      },
    },
    required: ['path', 'view_range'],
    additionalProperties: false,
  }),
})

const viewDirectory: RelaceSearchToolSchema = Object.freeze({
  name: 'view_directory',
  description: 'Tool for viewing the contents of a directory.\n\n* Lists contents recursively, relative to the input directory\n* Directories are suffixed with a trailing slash \'/\'\n* Depth might be limited by the tool implementation\n* Output is limited to the first 250 items\n\n Example output:\n file1.txt\n file2.txt\n subdir1/\n subdir1/file3.txt',
  strict: true,
  parameters: Object.freeze({
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to a directory, e.g. `/repo/`.' },
      include_hidden: {
        type: 'boolean',
        default: false,
        description: 'If true, include hidden files in the output (false by default).',
      },
    },
    required: ['path', 'include_hidden'],
    additionalProperties: false,
  }),
})

const grepSearch: RelaceSearchToolSchema = Object.freeze({
  name: 'grep_search',
  description: 'Fast text-based regex search that finds exact pattern matches within files or directories, utilizing the ripgrep command for efficient searching. Results will be formatted in the style of ripgrep and can be configured to include line numbers and content. To avoid overwhelming output, the results are capped at 50 matches. Use the include or exclude patterns to filter the search scope by file type or specific paths. This is best for finding exact text matches or regex patterns.',
  strict: true,
  parameters: Object.freeze({
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The regex pattern to search for' },
      case_sensitive: {
        type: 'boolean',
        default: true,
        description: 'Whether the search should be case sensitive',
      },
      exclude_pattern: { type: ['string', 'null'], description: 'Glob pattern for files to exclude' },
      include_pattern: { type: ['string', 'null'], description: "Glob pattern for files to include (e.g. '*.ts' for TypeScript files)" },
    },
    required: ['query', 'case_sensitive', 'exclude_pattern', 'include_pattern'],
    additionalProperties: false,
  }),
})

const bash: RelaceSearchToolSchema = Object.freeze({
  name: 'bash',
  description: 'Tool for executing bash commands.\n\n* Avoid long running commands\n* Avoid dangerous/destructive commands\n* Prefer using other more specialized tools where possible',
  strict: true,
  parameters: Object.freeze({
    type: 'object',
    properties: { command: { type: 'string', description: 'Bash command to execute' } },
    required: ['command'],
    additionalProperties: false,
  }),
})

const reportBack: RelaceSearchToolSchema = Object.freeze({
  name: 'report_back',
  description: 'This is a tool to use when you feel like you have finished exploring the codebase and understanding the problem, and now would like to report back to the user.',
  strict: true,
  parameters: Object.freeze({
    type: 'object',
    properties: {
      explanation: {
        type: 'string',
        description: 'Details your reasoning for deeming the files relevant for solving the issue.',
      },
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
        description: 'A dictionary where the keys are file paths and the values are lists of tuples representing the line ranges in each file that are relevant to solving the issue.',
      },
    },
    required: ['explanation', 'files'],
    additionalProperties: false,
  }),
})

export const RELACE_SEARCH_TOOLS: readonly RelaceSearchToolSchema[] = Object.freeze([
  viewFile,
  viewDirectory,
  grepSearch,
  bash,
  reportBack,
])

/** Return detached schemas suitable for a mutable DSH GenerateOptions value. */
export function relaceSearchToolSchemas(): ToolSchema[] {
  return RELACE_SEARCH_TOOLS.map(tool => ({
    ...tool,
    parameters: structuredClone(tool.parameters),
  }))
}

/** Validated arguments forwarded to the host's read-only search operations. */
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

export interface RelaceSearchReport {
  readonly explanation: string
  readonly files: Readonly<Record<string, readonly (readonly [number, number])[]>>
}

function argumentRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('relace tool arguments must be an object')
  }
  return value as Record<string, unknown>
}

function argumentString(value: unknown, field: string): string {
  return promptText(value, field)
}

function argumentBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`relace ${field} must be boolean`)
  return value
}

function argumentNullableString(value: unknown, field: string): string | null {
  if (value === null) return null
  return argumentString(value, field)
}

function argumentRange(value: unknown): readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2
    || !value.every(item => Number.isInteger(item))) {
    throw new Error('relace view_range must contain exactly two integers')
  }
  return [value[0] as number, value[1] as number]
}

function parseRelaceSearchReport(value: unknown): RelaceSearchReport {
  const record = argumentRecord(value)
  const explanation = argumentString(record.explanation, 'explanation')
  const filesRecord = argumentRecord(record.files)
  const files: Record<string, readonly (readonly [number, number])[]> = {}
  for (const [path, ranges] of Object.entries(filesRecord)) {
    if (path.trim().length === 0 || path.includes('\u0000') || !Array.isArray(ranges)) {
      throw new Error('relace report files must map paths to line ranges')
    }
    files[path] = Object.freeze(ranges.map(range => argumentRange(range)))
  }
  return Object.freeze({ explanation, files: Object.freeze(files) })
}

/**
 * Host bridge for the exact Relace search tools. The callbacks are the
 * security boundary: a host can resolve paths under its workspace, run only
 * an allowlisted read-only command, and apply its own output caps.
 */
export interface RelaceSearchToolBridge {
  readonly schemas: readonly ToolSchema[]
  execute(name: RelaceSearchToolName, args: unknown, signal?: AbortSignal): Promise<unknown>
  report(): RelaceSearchReport | undefined
}

export function createRelaceSearchToolBridge(
  handlers: RelaceSearchToolHandlers,
): RelaceSearchToolBridge {
  let finalReport: RelaceSearchReport | undefined
  return {
    schemas: Object.freeze(relaceSearchToolSchemas()),
    async execute(name, args, signal) {
      const record = argumentRecord(args)
      switch (name) {
        case 'view_file':
          return handlers.viewFile({
            path: argumentString(record.path, 'path'),
            view_range: argumentRange(record.view_range),
          }, signal)
        case 'view_directory':
          return handlers.viewDirectory({
            path: argumentString(record.path, 'path'),
            include_hidden: argumentBoolean(record.include_hidden, 'include_hidden'),
          }, signal)
        case 'grep_search':
          return handlers.grepSearch({
            query: argumentString(record.query, 'query'),
            case_sensitive: argumentBoolean(record.case_sensitive, 'case_sensitive'),
            exclude_pattern: argumentNullableString(record.exclude_pattern, 'exclude_pattern'),
            include_pattern: argumentNullableString(record.include_pattern, 'include_pattern'),
          }, signal)
        case 'bash':
          return handlers.bash({ command: argumentString(record.command, 'command') }, signal)
        case 'report_back':
          finalReport = parseRelaceSearchReport(record)
          return finalReport
      }
    },
    report: () => finalReport,
  }
}

/** Credential references for the two independent OpenRouter routes. */
export interface RelaceProviderCredentialRefs {
  readonly search: string
  readonly apply: string
}

/** One shared OpenRouter key is the default; callers may split the routes. */
export const RELACE_DEFAULT_CREDENTIAL_REFS = Object.freeze({
  search: 'OPENROUTER_API_KEY',
  apply: 'OPENROUTER_API_KEY',
} satisfies RelaceProviderCredentialRefs)

/**
 * Build OpenRouter provider rows without putting a key in the profile.
 * Separate references are useful when Search and Apply are vaulted or
 * rate-limited independently; the default keeps one-key OpenRouter setups
 * compatible.
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
      models: [{
        id: RELACE_SEARCH_MODEL,
        name: 'Relace Search',
        contextWindow: 262_144,
        maxTokens: 8_192,
      }],
    },
    [RELACE_APPLY_PROVIDER]: {
      displayName: 'Relace Apply 3 (OpenRouter)',
      apiKeyEnv: applyApiKeyEnv,
      api: 'openai-completions',
      baseURL: RELACE_OPENROUTER_BASE_URL,
      defaultContextWindow: 262_144,
      defaultMaxTokens: 32_768,
      models: [{
        id: RELACE_APPLY_MODEL,
        name: 'Relace Apply 3',
        contextWindow: 262_144,
        maxTokens: 32_768,
      }],
    },
  } satisfies Readonly<Record<string, PiAiProviderProfile>>)
}

export const RELACE_PROVIDER_PROFILES = buildRelaceProviderProfiles()

/** Search prompt contract copied into the harness layer, not the runner. */
export const RELACE_SEARCH_SYSTEM_PROMPT = [
  'You are an AI agent whose job is to explore a code base with the provided tools and thoroughly understand the problem.',
  'You should use the tools provided to explore the codebase, read files, search for specific terms, and execute bash commands as needed.',
  'Once you have a good understanding of the problem, use the `report_back` tool share your findings.',
  'Make sure to only use the `report_back` tool when you are confident that you have gathered enough information to make an informed decision.',
  'Your objective is speed and efficiency so call multiple tools at once where applicable to reduce latency and reduce the number of turns.',
  'You are given a limited number of turns so aim to call 4-12 tools in parallel. You are suggested to explain your reasoning for the tools you choose to call before calling them.',
  'The DSH host enforces the workspace root, output bounds, and a read-only command policy; do not edit, create, delete, or overwrite files.',
].join('\n')

function promptText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\u0000')) {
    throw new Error(`relace ${field} is required and must not contain NUL`)
  }
  return value
}

/** Build the documented `codebase` + `user_prompt` search input. */
export function buildRelaceSearchUserPrompt(input: {
  readonly codebase: string
  readonly userPrompt: string
}): string {
  const codebase = promptText(input.codebase, 'codebase')
  const userPrompt = promptText(input.userPrompt, 'userPrompt')
  if (userPrompt.toLowerCase().includes('</user_query>')) {
    throw new Error('relace userPrompt must not contain a closing user_query tag')
  }
  return [
    `I have uploaded a code repository in the ${codebase} directory.`,
    '',
    'Now consider the following user query:',
    '',
    '<user_query>',
    userPrompt,
    '</user_query>',
    'You need to resolve the <user_query>.',
    '',
    'To do this, follow the workflow below:',
    '',
    '---',
    '',
    'Your job is purely to understand the codebase.',
    '',
    '### 1. Explore and Understand the Codebase',
    '',
    'You **must first build a deep understanding of the relevant code**.',
    'Use the available tools to:',
    '',
    '- Locate and examine all relevant parts of the codebase.',
    '- Understand how the current code works, including expected behaviors, control flow, and edge cases.',
    '- Identify the potential root cause(s) of the issue or the entry points for the requested feature.',
    '- Review any related unit tests to understand expected behavior.',
    '',
    '---',
    '',
    '### 2. Report Back Your Understanding',
    '',
    'Once you believe you have a solid understanding of the issue and the relevant code:',
    '',
    '- Use the `report_back` tool to report your findings.',
    '- File paths should be relative to the project root, excluding the codebase path.',
    '- Only report relevant files within the repository. Speculative new files must not be reported.',
    '',
    'A successful resolution means the issue is well understood, the reasoning for relevant files is clear, and the files cover the key edits and supporting code.',
    '',
    '<use_parallel_tool_calls>',
    'If independent tool calls are needed, make them in parallel. Do not parallelize calls whose parameters depend on earlier results.',
    '</use_parallel_tool_calls>',
  ].join('\n')
}

/** Build a normal DSH request that the existing agent loop can drive. */
export function buildRelaceSearchGenerateOptions(input: {
  readonly codebase: string
  readonly userPrompt: string
}): GenerateOptions {
  return {
    provider: RELACE_SEARCH_PROVIDER,
    model: RELACE_SEARCH_MODEL,
    system: RELACE_SEARCH_SYSTEM_PROMPT,
    messages: [createUserMessage({
      content: [{ type: 'text', text: buildRelaceSearchUserPrompt(input) }],
      source: { kind: 'plugin', plugin: 'relace-search' },
    })],
    tools: relaceSearchToolSchemas(),
    maxTokens: 8_192,
  }
}

function taggedValue(value: unknown, field: string, tag: string, singleLine = false): string {
  const normalized = promptText(value, field)
  if (normalized.toLowerCase().includes(`</${tag.toLowerCase()}>`)) {
    throw new Error(`relace ${field} must not contain a closing ${tag} tag`)
  }
  if (singleLine && /[\r\n]/u.test(normalized)) {
    throw new Error(`relace ${field} must be a single line`)
  }
  return normalized
}

/**
 * Format Relace Instant Apply's required tagged user message. This is only a
 * request formatter: it never writes the returned merged code to disk.
 */
export function formatRelaceApplyPrompt(input: {
  readonly instruction?: string
  readonly initialCode: string
  readonly editSnippet: string
}): string {
  const instruction = input.instruction === undefined
    ? undefined
    : taggedValue(input.instruction, 'instruction', 'instruction', true)
  const code = taggedValue(input.initialCode, 'initialCode', 'code')
  const update = taggedValue(input.editSnippet, 'editSnippet', 'update')
  const result = [
    ...(instruction === undefined ? [] : [`<instruction>${instruction}</instruction>`]),
    `<code>${code}</code>`,
    `<update>${update}</update>`,
  ].join('\n')
  if (result.length > RELACE_APPLY_MAX_INPUT_CHARS) {
    throw new Error(`relace apply prompt exceeds ${RELACE_APPLY_MAX_INPUT_CHARS} characters`)
  }
  return result
}

/** Build the separate Apply-3 request with no tools or response-format hint. */
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
      source: { kind: 'plugin', plugin: 'relace-apply-3' },
    })],
    maxTokens: 32_768,
  }
}

/** Normalized result accepted from either a direct Apply response or OpenRouter chat content. */
export interface RelaceApplyResult {
  readonly mergedCode: string
  readonly usage?: Readonly<Record<string, unknown>>
}

/** Normalize a response without logging or persisting provider output. */
export function parseRelaceApplyResponse(payload: unknown): RelaceApplyResult {
  if (payload !== null && typeof payload === 'object' && 'mergedCode' in payload) {
    const mergedCode = (payload as { mergedCode?: unknown }).mergedCode
    if (typeof mergedCode === 'string') {
      const usage = (payload as { usage?: unknown }).usage
      return {
        mergedCode,
        ...(usage !== undefined && usage !== null && typeof usage === 'object'
          ? { usage: usage as Readonly<Record<string, unknown>> }
          : {}),
      }
    }
  }
  if (payload !== null && typeof payload === 'object' && 'choices' in payload) {
    const choices = (payload as { choices?: unknown }).choices
    const first = Array.isArray(choices) ? choices[0] : undefined
    const content = first !== null && typeof first === 'object'
      ? (first as { message?: { content?: unknown } }).message?.content
      : undefined
    if (typeof content === 'string') {
      const usage = (payload as { usage?: unknown }).usage
      return {
        mergedCode: content,
        ...(usage !== undefined && usage !== null && typeof usage === 'object'
          ? { usage: usage as Readonly<Record<string, unknown>> }
          : {}),
      }
    }
  }
  throw new Error('relace apply response did not contain merged code')
}
