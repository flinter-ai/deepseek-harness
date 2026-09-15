import fs from 'node:fs'

const logIndex = process.argv.indexOf('--log')
const logPath = logIndex >= 0 ? process.argv[logIndex + 1] : undefined

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { input += chunk })
process.stdin.on('end', () => {
  const rows = input.split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line))
  for (const request of rows) {
    if (logPath !== undefined) fs.appendFileSync(logPath, JSON.stringify(request) + '\n')
    const packetId = request.params?.packet_id ?? ''
    const response = request.method === 'packet_describe'
      ? {
          schema: 'packet-registry-service-v1', id: request.id, ok: true,
          operation: request.method, result: {
            schema: 'review-packet-v1', packet_id: packetId,
            source_sha256: 'source-sha', claim_ids: [], evidence_refs: ['c1'],
            claim_count: 0, evidence_count: 1,
            fixture_padding: 'x'.repeat(512),
          },
        }
      : request.method === 'evidence_get'
        ? {
            schema: 'packet-registry-service-v1', id: request.id, ok: true,
            operation: request.method, packet_id: packetId, source_sha256: 'source-sha',
            requested_refs: request.params.refs ?? ['c1'],
            limits: {
              max_total_chars: request.params.max_total_chars ?? 8000,
              max_item_chars: request.params.max_item_chars ?? 2500,
              max_items: request.params.max_items ?? 8,
            },
            result: {
              status: 'bounded', required_chars: 46, used_chars: 46,
              max_total_chars: request.params.max_total_chars ?? 8000,
              exchanges: {}, entries: [],
            },
          }
        : {
            schema: 'packet-registry-service-v1', id: request.id, ok: true,
            operation: request.method, packet_id: packetId,
            result: { packet_path: `${request.params.output_dir}/packet.json` },
          }
    process.stdout.write(JSON.stringify(response) + '\n')
  }
})
