/**
 * track.cotracker — deterministic tracker stub.
 *
 * Returns a fixed track descriptor and a content hash. Real implementation
 * will run CoTracker inside the container; this stub proves long-running job
 * protocol usage.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { createHash } from 'node:crypto'

export function trackCotrackerTool() {
  return defineTool({
    name: 'track.cotracker',
    description: 'Run CoTracker on a seeded window (deterministic stub).',
    parameters: {
      seeds: { type: 'array', items: { type: 'string' }, required: true, description: 'Seed frame identifiers' },
      window: { type: 'string', required: true, description: 'Video window identifier' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          artifact: { type: 'object', required: true, additionalProperties: true },
          content_hash: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `track.cotracker → ${value.content_hash.slice(0, 12)}` }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const descriptor = {
        window: args.window,
        seeds: args.seeds,
        tracks: args.seeds.map((s) => ({ seed: s, points: [] })),
        note: 'stub — real tracker not wired',
      }
      const hash = createHash('sha256').update(JSON.stringify(descriptor)).digest('hex')
      return { artifact: descriptor, content_hash: hash }
    },
  })
}
