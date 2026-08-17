/**
 * vlm.ask — VLM state-question stub.
 *
 * Returns a canned answer and a content hash. Real implementation will call
 * ARK/doubao with frames and a state question; this stub proves the model tool
 * surface without external network dependency.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { createHash } from 'node:crypto'

export function vlmAskTool() {
  return defineTool({
    name: 'vlm.ask',
    description: 'Ask a VLM a state question about frames (stub).',
    parameters: {
      frames_ref: { type: 'string', required: true, description: 'Content hash of the frames artifact' },
      question: { type: 'string', required: true, description: 'State question, e.g. "which gripper holds X"' },
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
      render: (_args, value) => [{ type: 'text', text: `vlm.ask → ${value.content_hash.slice(0, 12)}` }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
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
  })
}
