/**
 * boundary.detect — deterministic boundary detector stub.
 *
 * Returns a fixed candidate list and a content hash. Real implementation will
 * use Foote novelty on self-similarity; this stub proves candidate emission.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { createHash } from 'node:crypto'

export function boundaryDetectTool() {
  return defineTool({
    name: 'boundary.detect',
    description: 'Detect candidate boundaries from a track (deterministic stub).',
    parameters: {
      track_ref: { type: 'string', required: true, description: 'Content hash of the track artifact' },
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
      render: (_args, value) => [{ type: 'text', text: `boundary.detect → ${value.content_hash.slice(0, 12)}` }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
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
  })
}
