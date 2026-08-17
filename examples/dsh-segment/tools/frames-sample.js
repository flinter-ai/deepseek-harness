/**
 * frames.sample — deterministic frame sampler stub.
 *
 * Returns a fixed window descriptor and a content hash. Real implementation
 * will use DINOv2 self-similarity and Foote novelty; this stub proves the
 * tool-call → artifact-write path inside the container.
 */

import { createHash } from 'node:crypto'

export function framesSampleTool() {
  return {
    name: 'frames.sample',
    description: 'Sample frames from a video window (deterministic stub).',
    parameters: {
      type: 'object',
      properties: {
        window: { type: 'string', description: 'Video window identifier, e.g. "t0-t1"' },
        budget: { type: 'number', description: 'Frame budget', default: 12 },
      },
      required: ['window'],
    },
    async run(args, ctx) {
      const descriptor = {
        window: args.window,
        budget: args.budget ?? 12,
        frames: Array.from({ length: args.budget ?? 12 }, (_, i) => `frame_${i}`),
        note: 'stub — real sampler not wired',
      }
      const hash = createHash('sha256').update(JSON.stringify(descriptor)).digest('hex')
      return { artifact: descriptor, content_hash: hash }
    },
  }
}
