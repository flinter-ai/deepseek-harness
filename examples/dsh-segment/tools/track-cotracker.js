/**
 * track.cotracker — deterministic tracker stub.
 *
 * Returns a fixed track descriptor and a content hash. Real implementation
 * will run CoTracker inside the container; this stub proves long-running job
 * protocol usage.
 */

import { createHash } from 'node:crypto'

export function trackCotrackerTool() {
  return {
    name: 'track.cotracker',
    description: 'Run CoTracker on a seeded window (deterministic stub).',
    parameters: {
      type: 'object',
      properties: {
        seeds: { type: 'array', items: { type: 'string' }, description: 'Seed frame identifiers' },
        window: { type: 'string', description: 'Video window identifier' },
      },
      required: ['seeds', 'window'],
    },
    async run(args, ctx) {
      const descriptor = {
        window: args.window,
        seeds: args.seeds,
        tracks: args.seeds.map((s) => ({ seed: s, points: [] })),
        note: 'stub — real tracker not wired',
      }
      const hash = createHash('sha256').update(JSON.stringify(descriptor)).digest('hex')
      return { artifact: descriptor, content_hash: hash }
    },
  }
}
