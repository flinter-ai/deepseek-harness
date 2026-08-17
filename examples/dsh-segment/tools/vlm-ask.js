/**
 * vlm.ask — VLM state-question stub.
 *
 * Returns a canned answer and a content hash. Real implementation will call
 * ARK/doubao with frames and a state question; this stub proves the model tool
 * surface without external network dependency.
 */

import { createHash } from 'node:crypto'

export function vlmAskTool() {
  return {
    name: 'vlm.ask',
    description: 'Ask a VLM a state question about frames (stub).',
    parameters: {
      type: 'object',
      properties: {
        frames_ref: { type: 'string', description: 'Content hash of the frames artifact' },
        question: { type: 'string', description: 'State question, e.g. "which gripper holds X"' },
      },
      required: ['frames_ref', 'question'],
    },
    async run(args, ctx) {
      const descriptor = {
        frames_ref: args.frames_ref,
        question: args.question,
        answer: 'unknown — stub VLM',
        reasoning_effort: 'low',
        note: 'stub — real VLM not wired',
      }
      const hash = createHash('sha256').update(JSON.stringify(descriptor)).digest('hex')
      return { artifact: descriptor, content_hash: hash }
    },
  }
}
