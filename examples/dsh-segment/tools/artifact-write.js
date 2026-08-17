/**
 * artifact.write — write an artifact to the output location.
 *
 * Returns the written path and content hash. Real implementation will write to
 * B2; this stub writes to a local path so the container can prove artifact
 * emission.
 */

import { createHash } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function artifactWriteTool() {
  return {
    name: 'artifact.write',
    description: 'Write an artifact with its content hash (stub — local path).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Artifact name, e.g. "segments.json"' },
        data: { description: 'Artifact payload' },
        out_dir: { type: 'string', description: 'Output directory', default: '/tmp/dsh-segment-artifacts' },
      },
      required: ['name', 'data'],
    },
    async run(args, ctx) {
      const outDir = args.out_dir ?? '/tmp/dsh-segment-artifacts'
      mkdirSync(outDir, { recursive: true })
      const path = join(outDir, args.name)
      const body = JSON.stringify(args.data, null, 2)
      writeFileSync(path, body)
      const hash = createHash('sha256').update(body).digest('hex')
      return { artifact: { path, name: args.name }, content_hash: hash }
    },
  }
}
