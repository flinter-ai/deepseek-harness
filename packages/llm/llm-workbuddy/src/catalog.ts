import type { PiAiModelProfile, PiAiReasoningEfforts } from '@deepseek-ai/dsh-llm-pi-ai'

export const WORKBUDDY_MODELS: readonly string[] = [
  'deepseek-v3', 'deepseek-v3-0324', 'deepseek-v3-1',
  'deepseek-v3-0324-lkeap', 'deepseek-v3-1-lkeap',
  'deepseek-r1', 'deepseek-r1-0528', 'deepseek-r1-0528-lkeap',
  'deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v3-2-volc',
  'kimi-k2.5', 'kimi-k2.6', 'kimi-k2.7', 'kimi-k3-1',
  'hunyuan-chat', 'hunyuan-2.0-instruct', 'hunyuan-2.0-thinking',
  'minimax-m2.7',
  'glm-4.7', 'glm-5.0', 'glm-5.1', 'glm-5.2', 'glm-5.0-turbo', 'glm-5v-turbo',
  'hy3', 'hy3-preview', 'hy3-preview-agent', 'hy4-preview',
] as const

export const WORKBUDDY_THINKING_CAPABLE: ReadonlySet<string> = new Set([
  'deepseek-v3', 'deepseek-v3-0324', 'deepseek-v3-1',
  'deepseek-r1', 'deepseek-r1-0528', 'deepseek-v4-flash', 'deepseek-v4-pro',
  'deepseek-v3-2-volc', 'glm-5.0', 'glm-5.1', 'glm-5.2',
  'kimi-k2.5', 'kimi-k2.6', 'kimi-k2.7', 'kimi-k3-1',
  'hy3-preview', 'hy3-preview-agent', 'hy4-preview',
  'hunyuan-2.0-thinking',
])

export const WORKBUDDY_REASONING_EFFORTS: PiAiReasoningEfforts = Object.freeze({
  off: 'none',
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'max',
})

export function workbuddyCatalog(): PiAiModelProfile[] {
  return WORKBUDDY_MODELS.map(id => ({
    id,
    name: id,
    ...(WORKBUDDY_THINKING_CAPABLE.has(id)
      ? { reasoningEfforts: WORKBUDDY_REASONING_EFFORTS }
      : { reasoningEfforts: false }),
  }))
}
