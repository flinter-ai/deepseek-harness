/**
 * boundary.detect — deterministic boundary detector stub.
 *
 * Returns a fixed candidate list and a content hash. Real implementation will
 * use Foote novelty on self-similarity; this stub proves candidate emission.
 */

import { createHash } from 'node:crypto'

export function boundaryDetectTool() {
  return {
    name: 'boundary.detect',
    description: 'Detect candidate boundaries from a track (deterministic stub).',
    parameters: {
      type: 'object',
      properties: {
        track_ref: { type: 'string', description: 'Content hash of the track artifact' },
      },
      required: ['track_ref'],
    },
    async run(args, ctx) {
      const descriptor = {
        track_ref: args.track_ref,
        candidates: [
          { t: '00:12', score: 0.81, kind: 'state_change' },
          { t: '00:47', score: 0.66, kind: 'state_change' },
        ],
        note: 'stub — real detector not wired',
      }
      const hash = createHash('sha256').update(JSON.stringify(descriptor)).digest('hex')
      return { artifact: descriptor, content_hash: hash }
    },
  }
}
