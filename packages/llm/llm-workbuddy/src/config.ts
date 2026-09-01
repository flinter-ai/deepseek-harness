import z from '@deepseek-ai/schemastery'
import type {
  PiAiModelProfile, PiAiProviderProfile, PiAiReasoningEfforts,
} from '@deepseek-ai/dsh-llm-pi-ai'
import { workbuddyCatalog } from './catalog.ts'

export const WORKBUDDY_PROVIDER = 'workbuddy' as const
export const DEFAULT_BASE_URL = 'http://127.0.0.1:8000/v1'
export const DEFAULT_API_KEY_ENV = 'WORKBUDDY_API_KEY'
export const DEFAULT_DISPLAY_NAME = 'workbuddy2api'

const workbuddyModel = z.object({
  id: z.string().required(),
  name: z.string(),
  contextWindow: z.number().min(1),
  maxTokens: z.number().min(1),
  reasoningEfforts: z.union([
    z.const(false),
    z.dict(
      z.union([z.string(), z.const(null)]),
      z.union(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
    ) as unknown as z<PiAiReasoningEfforts>,
  ]),
}) as unknown as z<PiAiModelProfile>

export interface WorkbuddyConfig {
  displayName?: string
  apiKeyEnv?: string
  baseURL?: string
  models?: PiAiModelProfile[]
}

export const Config = z.object({
  displayName: z.string().default(DEFAULT_DISPLAY_NAME),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string().default(DEFAULT_BASE_URL),
  models: z.array(workbuddyModel),
}) as z<WorkbuddyConfig>

export function buildWorkbuddyProfile(config: WorkbuddyConfig): PiAiProviderProfile {
  return {
    api: 'openai-completions',
    apiKeyEnv: config.apiKeyEnv ?? DEFAULT_API_KEY_ENV,
    baseURL: config.baseURL ?? DEFAULT_BASE_URL,
    displayName: config.displayName ?? DEFAULT_DISPLAY_NAME,
    models: config.models !== undefined && config.models.length > 0
      ? config.models
      : workbuddyCatalog(),
  }
}
