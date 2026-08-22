/**
 * writeArtifact — write an artifact payload to a local path (internal).
 *
 * S0's artifact.write tool, internalized for S1: no external tool registers
 * it; the RUN_BASELINE_PHYSICS adapter calls this directly to materialize the
 * composed stub payload. Returns the written path and a sha256 content hash
 * over the exact bytes written. Real implementation will write to B2.
 */

import { createHash } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function writeArtifact(name, data, outDir = '/tmp/dsh-segment-artifacts') {
  mkdirSync(outDir, { recursive: true })
  const path = join(outDir, name)
  const body = JSON.stringify(data, null, 2)
  writeFileSync(path, body)
  const contentHash = createHash('sha256').update(body).digest('hex')
  return { artifact: { path, name }, content_hash: contentHash }
}
