#!/usr/bin/env node
import { fenceDispatch } from './reliability.mjs'

function flag(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const dispatch = flag('dispatch')
if (!dispatch) {
  console.error('usage: node fence-dsh-worker.mjs --dispatch <dispatch_id> [--abandon] [--retry-request <id>]')
  process.exit(2)
}

try {
  const result = fenceDispatch(dispatch, {
    abandon: process.argv.includes('--abandon'),
    retryRequest: flag('retry-request'),
  })
  console.log(JSON.stringify(result))
} catch (error) {
  console.error(`fence-dsh-worker: ${error.message}`)
  process.exit(1)
}
