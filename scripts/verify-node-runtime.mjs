import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

/**
 * Parse the numeric part of a Node version. The hook only needs release
 * versions, so prerelease/build metadata is intentionally ignored.
 */
export function parseNodeVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!match) throw new Error(`cannot parse Node version ${JSON.stringify(version)}`)
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

function compareVersions(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] - right[key]
  }
  return 0
}

function satisfiesTerm(version, term) {
  const caret = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(term)
  if (caret) {
    const floor = { major: Number(caret[1]), minor: Number(caret[2]), patch: Number(caret[3]) }
    const ceiling = { major: floor.major + 1, minor: 0, patch: 0 }
    return compareVersions(version, floor) >= 0 && compareVersions(version, ceiling) < 0
  }

  const minimum = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(term)
  if (minimum) {
    return compareVersions(version, {
      major: Number(minimum[1]),
      minor: Number(minimum[2]),
      patch: Number(minimum[3]),
    }) >= 0
  }

  throw new Error(`unsupported Node engine term ${JSON.stringify(term)}`)
}

export function satisfiesNodeEngine(version, engine) {
  return engine.split('||').some(term => satisfiesTerm(version, term.trim()))
}

export function readNodeEngine(root = repositoryRoot) {
  const packageJson = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'))
  const engine = packageJson.engines?.node
  if (typeof engine !== 'string' || engine.length === 0) {
    throw new Error('package.json must declare engines.node')
  }
  return engine
}

export function verifyNodeRuntime(version = process.versions.node, root = repositoryRoot) {
  const parsed = parseNodeVersion(version)
  const engine = readNodeEngine(root)
  if (!satisfiesNodeEngine(parsed, engine)) {
    throw new Error(`Node ${version} does not satisfy the repository engine contract ${engine}`)
  }
  return { version, engine }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = verifyNodeRuntime()
    console.log(`verify-node-runtime: Node ${result.version} satisfies ${result.engine}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`verify-node-runtime: ${message}`)
    console.error('Select Node 24+ (Node 25 is valid) or Node 22.19+, then retry.')
    console.error(`Current executable: ${process.execPath}`)
    process.exitCode = 1
  }
}
