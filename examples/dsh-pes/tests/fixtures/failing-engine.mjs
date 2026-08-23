#!/usr/bin/env node
/**
 * Engine-shaped fixture for structured failure paths — TEST FIXTURE ONLY.
 * Flags:
 *   --exit N        print a diagnostic to stderr and exit N with no stdout
 *   --violation K   emit a protocol-violating stdout and exit 0
 *                   K: missing-envelope | two-lines | bad-json
 */

const argv = process.argv.slice(2)
const exitIndex = argv.indexOf('--exit')
const violationIndex = argv.indexOf('--violation')

if (exitIndex !== -1) {
  const code = Number(argv[exitIndex + 1])
  process.stderr.write(`engine exploded with code ${code}\n`)
  process.exit(code)
}

if (violationIndex !== -1) {
  const kind = argv[violationIndex + 1]
  if (kind === 'missing-envelope') {
    process.stdout.write('{"mode":"search","count":1}\n')
  } else if (kind === 'two-lines') {
    process.stdout.write('{"mode":"search","count":0,"event_ids":[],"abstained":false,"events":[]}\n')
    process.stdout.write('{"mode":"search","count":0,"event_ids":[],"abstained":false,"events":[]}\n')
  } else if (kind === 'bad-json') {
    process.stdout.write('this is not json\n')
  }
  process.exit(0)
}

process.exit(3)