/**
 * frames.sample — deterministic frame sampler stub.
 *
 * Returns a fixed window descriptor and a content hash. Real implementation
 * will use DINOv2 self-similarity and Foote novelty; this stub proves the
 * tool-call → artifact-write path inside the container.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { createHash } from 'node:crypto'

export function framesSampleTool() {
  return defineTool({
    name: 'frames.sample',
    description: 'Sample frames from a video window (deterministic stub).',
    parameters: {
      window: { type: 'string', required: true, description: 'Video window identifier, e.g. "t0-t1"' },
      budget: { type: 'number', description: 'Frame budget', default: 12 },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          artifact: { type: 'object', required: true },
          content_hash: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `frames.sample → ${value.content_hash.slice(0, 12)}` }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const descriptor = {
        window: args.window,
        budget: args.budget ?? 12,
        frames: Array.from({ length: args.budget ?? 12 }, (_, i) => `frame_${i}`),
        note: 'stub — real sampler not wired',
      }
      const hash = createHash('sha256').update(JSON.stringify(descriptor)).digest('hex')
      return { artifact: descriptor, content_hash: hash }
    },
  })
}
