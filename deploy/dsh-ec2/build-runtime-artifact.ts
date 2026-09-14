/** Build and verify the symlink-free production dependency closure for DSH Web on EC2. */

import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..')
const RUNTIME_PACKAGE = '@deepseek-ai/dsh-ec2-runtime'
const REQUIRED_PACKAGES = [
  '@deepseek-ai/dsh',
  '@deepseek-ai/dsh-alpha-profile',
  '@deepseek-ai/dsh-api-source-controller',
  '@deepseek-ai/dsh-aws-worker-profile',
  '@deepseek-ai/dsh-client-ui-source-editor',
  '@deepseek-ai/dsh-credentials-aws-secrets-manager',
  '@deepseek-ai/dsh-host-source-publisher-github',
  '@deepseek-ai/dsh-source-draft-model',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/schemastery',
] as const
const PROFILE_BUNDLES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-aws-worker-profile',
] as const
const SHA_PATTERN = /^[0-9a-f]{40}$/u
const ARCHES = new Set(['arm64', 'x64'])
const PLATFORMS = new Set(['linux', 'darwin'])

interface RuntimeFile {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

interface RuntimeManifest {
  readonly schemaVersion: 1
  readonly package: string
  readonly packageVersion: string
  readonly sourceSha: string
  readonly target: {
    readonly platform: string
    readonly arch: string
  }
  readonly files: readonly RuntimeFile[]
}

function fail(message: string): never {
  throw new Error(`dsh-ec2-artifact: ${message}`)
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function run(command: string, args: readonly string[], cwd = REPOSITORY_ROOT): void {
  const result = spawnSync(command, [...args], {
    cwd,
    env: { ...process.env, CI: 'true' },
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw new Error(`dsh-ec2-artifact: ${command} failed: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`dsh-ec2-artifact: ${command} exited with ${String(result.status)}`)
}

function capture(command: string, args: readonly string[], cwd = REPOSITORY_ROOT): string {
  try {
    return execFileSync(command, [...args], { cwd, encoding: 'utf8' }).trim()
  } catch (error) {
    throw new Error(`dsh-ec2-artifact: failed to read ${command} output: ${String(error)}`)
  }
}

function deployRuntime(stage: string): void {
  // pnpm 11 may append unresolved native build approvals to the workspace
  // manifest while running deploy. The artifact builder is a read-only
  // consumer of the source checkout; never leave that tool-generated edit in
  // the worktree or in the CI checkout used for the source-SHA attestation.
  const workspaceManifest = join(REPOSITORY_ROOT, 'pnpm-workspace.yaml')
  const original = readFileSync(workspaceManifest)
  try {
    run('pnpm', [
      '--filter', RUNTIME_PACKAGE,
      'deploy',
      '--legacy',
      '--prod',
      '--config.allow-unused-patches=true',
      '--config.node-linker=hoisted',
      '--config.auto-install-peers=false',
      '--config.link-workspace-packages=true',
      '--config.strict-dep-builds=false',
      '--config.confirmModulesPurge=false',
      stage,
    ])
  } finally {
    writeFileSync(workspaceManifest, original)
  }
}

function sourceSha(requested: string | undefined): string {
  const value = requested ?? capture('git', ['rev-parse', 'HEAD'])
  if (!SHA_PATTERN.test(value)) fail(`source SHA must be a full commit SHA, got ${JSON.stringify(value)}`)
  return value
}

function packageVersion(stage: string): string {
  const path = join(stage, 'package.json')
  if (!existsSync(path)) fail(`deployed package manifest is missing: ${path}`)
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('deployed package manifest is invalid')
  const version = (value as { version?: unknown }).version
  if (typeof version !== 'string' || version.length === 0) fail('deployed package manifest has no version')
  return version
}

function findSymlink(root: string): string | undefined {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    const metadata = lstatSync(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = findSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

function copyWithoutNestedNodeModules(source: string, destination: string): void {
  cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter: path => {
      const relativePath = relative(source, path)
      return relativePath !== 'node_modules'
        && !relativePath.startsWith(`node_modules${sep}`)
    },
  })
}

/** Replace pnpm links with real files while retaining one flat dependency tree. */
function materializeNodeModules(nodeModules: string): void {
  let link = findSymlink(nodeModules)
  while (link !== undefined) {
    const source = realpathSync(link)
    rmSync(link, { recursive: true, force: true })
    copyWithoutNestedNodeModules(source, link)
    link = findSymlink(nodeModules)
  }
}

function pruneRuntimeNoise(nodeModules: string): void {
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const metadata = lstatSync(path)
      if (metadata.isDirectory()) {
        if (entry.name === '.bin' || entry.name === '.pnpm') {
          rmSync(path, { recursive: true, force: true })
        } else {
          visit(path)
        }
      } else if (entry.name === '.modules.yaml' || entry.name === '.pnpm-workspace-state-v1.json') {
        rmSync(path, { force: true })
      } else if (metadata.isFile() && (/\.d\.(?:c|m)?ts$/u.test(entry.name)
        || entry.name.endsWith('.map')
        || entry.name.endsWith('.tsbuildinfo'))) {
        rmSync(path, { force: true })
      }
    }
  }
  visit(nodeModules)
}

interface PackageManifest {
  readonly dependencies?: Record<string, unknown>
  readonly peerDependencies?: Record<string, unknown>
  readonly peerDependenciesMeta?: Record<string, { readonly optional?: boolean }>
  readonly dsh?: { readonly bundle?: { readonly patch?: string } }
}

function packageManifestPath(nodeModules: string, packageName: string): string {
  return join(nodeModules, ...packageName.split('/'), 'package.json')
}

/** Assert that every non-optional package in the shipped profile graph is present. */
function validateProfileClosure(root: string): void {
  const nodeModules = join(root, 'node_modules')
  const queue: Array<{ readonly name: string; readonly required: boolean }> = PROFILE_BUNDLES.map(name => ({
    name,
    required: true,
  }))
  const visited = new Set<string>()
  const missing = new Set<string>()

  while (queue.length > 0) {
    const next = queue.shift()
    if (next === undefined || visited.has(next.name)) continue
    visited.add(next.name)
    const manifestPath = packageManifestPath(nodeModules, next.name)
    if (!existsSync(manifestPath)) {
      if (next.required) missing.add(next.name)
      continue
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      queue.push({ name: dependency, required: true })
    }
    for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
      queue.push({
        name: peer,
        required: manifest.peerDependenciesMeta?.[peer]?.optional !== true,
      })
    }
  }

  if (missing.size > 0) {
    fail(`profile dependency closure is missing: ${[...missing].sort().join(', ')}`)
  }
}

function workspacePackageDirectories(): Map<string, string> {
  const packages = new Map<string, string>()
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(path)
      } else if (entry.name === 'package.json') {
        const manifest = JSON.parse(readFileSync(path, 'utf8')) as { readonly name?: unknown }
        if (typeof manifest.name === 'string') packages.set(manifest.name, dirname(path))
      }
    }
  }
  for (const directory of ['packages', 'apps', 'vendor']) {
    const path = join(REPOSITORY_ROOT, directory)
    if (existsSync(path)) visit(path)
  }
  return packages
}

/** Fill legacy-deploy omissions from already-built workspace package files. */
function ensureWorkspaceProfileClosure(stage: string): void {
  const packageDirectories = workspacePackageDirectories()
  const nodeModules = join(stage, 'node_modules')
  const queue = [...new Set([...REQUIRED_PACKAGES, ...PROFILE_BUNDLES])]
  const visited = new Set<string>()

  while (queue.length > 0) {
    const packageName = queue.shift()
    if (packageName === undefined || visited.has(packageName)) continue
    visited.add(packageName)
    const manifestPath = packageManifestPath(nodeModules, packageName)
    if (!existsSync(manifestPath)) {
      const source = packageDirectories.get(packageName)
      if (source === undefined) continue
      const destination = dirname(manifestPath)
      mkdirSync(destination, { recursive: true })
      copyFileSync(join(source, 'package.json'), manifestPath)
      for (const directoryName of ['lib', 'config', 'bin', 'dist']) {
        const sourceDirectory = join(source, directoryName)
        if (existsSync(sourceDirectory)) {
          copyWithoutNestedNodeModules(sourceDirectory, join(destination, directoryName))
        }
      }
      const sourceManifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')) as PackageManifest
      const patch = sourceManifest.dsh?.bundle?.patch
      if (typeof patch === 'string') {
        const sourcePatch = resolve(source, patch)
        if (existsSync(sourcePatch)) {
          const destinationPatch = join(destination, patch)
          mkdirSync(dirname(destinationPatch), { recursive: true })
          copyFileSync(sourcePatch, destinationPatch)
        }
      }
    }
    if (!existsSync(manifestPath)) fail(`workspace package cannot be staged: ${packageName}`)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
    for (const dependency of Object.keys(manifest.dependencies ?? {})) queue.push(dependency)
    for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
      if (manifest.peerDependenciesMeta?.[peer]?.optional !== true) queue.push(peer)
    }
  }
}

/** Boot the shipped EC2 profile far enough to prove the authenticated Web boundary. */
function profileBootSmoke(root: string, home: string): void {
  const profileDir = join(home, 'profiles', 'tod')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-tod-artifact-smoke',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: PROFILE_BUNDLES, patchReload: 'startup' } },
  }, undefined, 2)}\n`)
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')

  const port = 31937
  const logPath = join(home, 'profile-boot.log')
  const idleStatePath = join(home, 'idle-state.json')
  const quote = (value: string): string => `'${value.replace(/'/gu, "'\\''")}'`
  const script = [
    'set -eu',
    `DSH_HOME=${quote(home)} DSH_PROFILE=tod DSH_PORT=${port} DSH_COMPUTE_BACKEND=ec2 DSH_IDLE_GUARD_ENABLED=1 DSH_IDLE_STATE_FILE=${quote(idleStatePath)} NODE_OPTIONS='' ${quote(join(root, 'launch.sh'))} --no-open >${quote(logPath)} 2>&1 &`,
    'pid=$!',
    'cleanup() { kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; }',
    'trap cleanup EXIT HUP INT TERM',
    'attempt=0',
    'while [ "$attempt" -lt 30 ]; do',
    `  http_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:${port}/" || true)`,
    '  if [ "$http_status" = 401 ]; then',
    '    state_attempt=0',
    `    while [ "$state_attempt" -lt 10 ] && [ ! -s ${quote(idleStatePath)} ]; do sleep 1; state_attempt=$((state_attempt + 1)); done`,
    `    test -s ${quote(idleStatePath)}`,
    `    grep -q '\"schemaVersion\":2' ${quote(idleStatePath)}`,
    `    grep -q '\"capabilitiesReady\":true' ${quote(idleStatePath)}`,
    `    grep -q '\"activeHttpRequests\":0' ${quote(idleStatePath)}`,
    `    grep -q '\"activeWebSockets\":0' ${quote(idleStatePath)}`,
    `    grep -q '\"activeJobs\":0' ${quote(idleStatePath)}`,
    `    grep -q '\"activePtys\":0' ${quote(idleStatePath)}`,
    '    exit 0',
    '  fi',
    '  if ! kill -0 "$pid" 2>/dev/null; then break; fi',
    '  attempt=$((attempt + 1))',
    '  sleep 1',
    'done',
    `cat ${quote(logPath)} >&2 2>/dev/null || true`,
    'exit 1',
  ].join('\n')
  const result = spawnSync('/bin/sh', ['-c', script], {
    cwd: root,
    env: { ...process.env, NODE_OPTIONS: '' },
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  })
  if (result.error !== undefined || result.status !== 0) {
    const log = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim() : ''
    const detail = [result.error?.message, result.stderr.trim(), log].filter(Boolean).join('\n').slice(-12_000)
    fail(`real tod profile boot smoke failed: ${detail || `exit ${String(result.status)}`}`)
  }
}

function writeRuntimeSupport(stage: string): void {
  const support = join(stage, 'runtime-support')
  mkdirSync(support, { recursive: true })
  copyFileSync(
    join(REPOSITORY_ROOT, 'packages/flinter/dsh-alpha-profile/local/tod.py'),
    join(support, 'alpha-tod.py'),
  )
  copyFileSync(
    join(REPOSITORY_ROOT, 'packages/flinter/dsh-aws-worker-profile/cordis.patch.yml'),
    join(support, 'aws-worker.patch.yml'),
  )
  const launcher = `#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DSH_HOME=\${DSH_HOME:-/root/.dsh-phase2}
DSH_PROFILE=\${DSH_PROFILE:-tod}
DSH_PORT=\${DSH_PORT:-3080}
DSH_COMPUTE_BACKEND=\${DSH_COMPUTE_BACKEND:-ec2}
PYTHON=\${PYTHON:-python3}

if [ ! -f "$DSH_HOME/settings.yaml" ]; then
  echo 'dsh-ec2-runtime: settings file is missing: '"$DSH_HOME/settings.yaml" >&2
  exit 1
fi

# A fresh host may not have the custom profile directory yet. Initialize it
# from DSH's shipped Web template once; the persistent profile remains host-
# owned state and is never bundled with credentials.
if [ ! -f "$DSH_HOME/profiles/$DSH_PROFILE/package.json" ]; then
  DSH_HOME="$DSH_HOME" node "$ROOT/runtime-bootstrap.mjs" \\
    --profile "$DSH_PROFILE" --from-default-profile web --dump-config >/dev/null
fi

"$PYTHON" "$ROOT/runtime-support/alpha-tod.py" --home "$DSH_HOME"

# Provider credentials stay in the host-owned credential provider. Remove
# inherited key-shaped values before entering DSH and stamp the production
# compute backend explicitly. Existing hosts may already compose the public
# AWS worker profile, whose package-owned patch must not be applied twice.
if grep -Fq '@deepseek-ai/dsh-aws-worker-profile' "$DSH_HOME/profiles/$DSH_PROFILE/package.json" 2>/dev/null; then
  exec env \\
    -u DEEPSEEK_API_KEY -u ARK_API_KEY -u ARK_PLAN_API_KEY \\
    -u MODELFLARE_API_KEY -u GMI_SERVING_API_KEY \\
    -u OPENROUTER_API_KEY -u OPENROUTER_RELACE_SEARCH_API_KEY \\
    -u OPENROUTER_RELACE_APPLY_API_KEY -u RELACE_SEARCH_API_KEY \\
    -u RELACE_APPLY_API_KEY \\
    DSH_COMPUTE_BACKEND="$DSH_COMPUTE_BACKEND" \\
    node "$ROOT/runtime-bootstrap.mjs" \\
      --profile "$DSH_PROFILE" \\
      "$@" \\
      --port "$DSH_PORT"
fi

exec env \\
  -u DEEPSEEK_API_KEY -u ARK_API_KEY -u ARK_PLAN_API_KEY \\
  -u MODELFLARE_API_KEY -u GMI_SERVING_API_KEY \\
  -u OPENROUTER_API_KEY -u OPENROUTER_RELACE_SEARCH_API_KEY \\
  -u OPENROUTER_RELACE_APPLY_API_KEY -u RELACE_SEARCH_API_KEY \\
  -u RELACE_APPLY_API_KEY \\
  DSH_COMPUTE_BACKEND="$DSH_COMPUTE_BACKEND" \\
  node "$ROOT/runtime-bootstrap.mjs" \\
    --profile "$DSH_PROFILE" \\
    --patch "$ROOT/runtime-support/aws-worker.patch.yml" \\
    "$@" \\
    --port "$DSH_PORT"
`
  writeFileSync(join(stage, 'launch.sh'), launcher, { mode: 0o755 })
  chmodSync(join(stage, 'launch.sh'), 0o755)
}

function runtimeFiles(root: string): RuntimeFile[] {
  const files: RuntimeFile[] = []
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const metadata = lstatSync(path)
      if (metadata.isDirectory()) {
        visit(path)
      } else if (metadata.isSymbolicLink()) {
        fail(`runtime tree still contains a symlink: ${relative(root, path)}`)
      } else if (metadata.isFile()) {
        const relativePath = relative(root, path).split(sep).join('/')
        if (relativePath === 'artifact-manifest.json') continue
        files.push({ path: relativePath, bytes: statSync(path).size, sha256: sha256(path) })
      }
    }
  }
  visit(root)
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

function verifyManifest(root: string, manifest: RuntimeManifest): void {
  if (manifest.schemaVersion !== 1 || manifest.package !== RUNTIME_PACKAGE) fail('runtime manifest identity is invalid')
  for (const file of manifest.files) {
    const path = join(root, file.path)
    if (!existsSync(path) || !lstatSync(path).isFile()) fail(`manifest file is missing: ${file.path}`)
    const actualBytes = statSync(path).size
    const actualSha = sha256(path)
    if (actualBytes !== file.bytes || actualSha !== file.sha256) {
      fail(`manifest checksum mismatch: ${file.path}`)
    }
  }
}

function smoke(root: string): void {
  const home = mkdtempSync(join(tmpdir(), 'dsh-ec2-artifact-home-'))
  try {
    const result = spawnSync(process.execPath, [join(root, 'runtime-bootstrap.mjs'), '--help'], {
      cwd: root,
      env: { ...process.env, DSH_HOME: home, NODE_OPTIONS: '' },
      encoding: 'utf8',
      timeout: 120_000,
    })
    if (result.error !== undefined || result.status !== 0) {
      const detail = result.error?.message ?? result.stderr.trim() ?? `exit ${String(result.status)}`
      fail(`clean runtime help smoke failed: ${detail}`)
    }
    if (!result.stdout.includes('Usage: dsh')) fail('clean runtime help smoke produced no DSH usage output')
    const web = spawnSync(process.execPath, [join(root, 'runtime-bootstrap.mjs'), '--profile', 'web', '--help'], {
      cwd: root,
      env: { ...process.env, DSH_HOME: home, NODE_OPTIONS: '' },
      encoding: 'utf8',
      timeout: 120_000,
    })
    if (web.error !== undefined || web.status !== 0) {
      const detail = web.error?.message ?? web.stderr.trim() ?? `exit ${String(web.status)}`
      fail(`clean Web profile help smoke failed: ${detail}`)
    }
    if (!web.stdout.includes('Usage: dsh --profile web')) fail('clean Web profile help smoke produced no Web usage output')
    writeFileSync(join(home, 'settings.yaml'), [
      'agent-default-model:',
      '  model: gpt-5.6-sol',
      '  provider: modelflare',
      '  reasoningEffort: high',
      '',
    ].join('\n'), { mode: 0o600 })
    const launcher = spawnSync('/bin/sh', [join(root, 'launch.sh'), '--help'], {
      cwd: root,
      env: { ...process.env, DSH_HOME: home, DSH_COMPUTE_BACKEND: 'ec2', NODE_OPTIONS: '' },
      encoding: 'utf8',
      timeout: 120_000,
    })
    if (launcher.error !== undefined || launcher.status !== 0) {
      const detail = launcher.error?.message ?? launcher.stderr.trim() ?? `exit ${String(launcher.status)}`
      fail(`clean EC2 launcher help smoke failed: ${detail}`)
    }
    if (!launcher.stdout.includes('Usage: dsh --profile web')) fail('clean EC2 launcher smoke produced no Web usage output')
    profileBootSmoke(root, home)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

function archive(
  stage: string,
  output: string,
  source: string,
  target: RuntimeManifest['target'],
  manifest: RuntimeManifest,
): string {
  mkdirSync(output, { recursive: true })
  const archiveName = `dsh-ec2-runtime-${source}-${target.platform}-${target.arch}.tar.gz`
  const archivePath = join(output, archiveName)
  run('tar', ['-czf', archivePath, '-C', stage, '.'])
  const digest = sha256(archivePath)
  writeFileSync(`${archivePath}.sha256`, `${digest}  ${archiveName}\n`, { mode: 0o644 })
  writeFileSync(
    join(output, archiveName.replace(/\.tar\.gz$/u, '.manifest.json')),
    `${JSON.stringify(manifest, undefined, 2)}\n`,
    { mode: 0o644 },
  )
  return archivePath
}

function parseCli(): { output: string; sourceSha: string | undefined; skipSmoke: boolean } {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      'source-sha': { type: 'string' },
      'skip-smoke': { type: 'boolean' },
    },
    allowPositionals: false,
  })
  return {
    output: resolve(REPOSITORY_ROOT, values.out ?? 'dist/dsh-ec2'),
    sourceSha: values['source-sha'],
    skipSmoke: values['skip-smoke'] ?? false,
  }
}

function main(): void {
  const cli = parseCli()
  const target = { platform: process.platform, arch: process.arch }
  if (!PLATFORMS.has(target.platform)) fail(`unsupported build platform ${target.platform}`)
  if (!ARCHES.has(target.arch)) fail(`unsupported build architecture ${target.arch}`)
  const source = sourceSha(cli.sourceSha)
  const stage = mkdtempSync(join(tmpdir(), 'dsh-ec2-artifact-stage-'))

  try {
    deployRuntime(stage)
    materializeNodeModules(join(stage, 'node_modules'))
    pruneRuntimeNoise(join(stage, 'node_modules'))
    ensureWorkspaceProfileClosure(stage)

    for (const packageName of REQUIRED_PACKAGES) {
      const packageRoot = join(stage, 'node_modules', ...packageName.split('/'))
      if (!existsSync(join(packageRoot, 'package.json'))) fail(`runtime closure is missing ${packageName}`)
    }
    if (!existsSync(join(stage, 'runtime-bootstrap.mjs'))) fail('runtime bootstrap is missing from deploy output')

    validateProfileClosure(stage)
    writeRuntimeSupport(stage)
    rmSync(join(stage, 'README.zh.md'), { force: true })
    if (findSymlink(stage) !== undefined) fail('runtime tree contains an unexpected symlink')

    const manifest: RuntimeManifest = {
      schemaVersion: 1,
      package: RUNTIME_PACKAGE,
      packageVersion: packageVersion(stage),
      sourceSha: source,
      target,
      files: runtimeFiles(stage),
    }
    writeFileSync(join(stage, 'artifact-manifest.json'), `${JSON.stringify(manifest, undefined, 2)}\n`, { mode: 0o644 })
    verifyManifest(stage, manifest)
    if (!cli.skipSmoke) smoke(stage)

    const archivePath = archive(stage, cli.output, source, target, manifest)
    const extracted = mkdtempSync(join(tmpdir(), 'dsh-ec2-artifact-extracted-'))
    try {
      run('tar', ['-xzf', archivePath, '-C', extracted])
      const extractedManifest = JSON.parse(readFileSync(join(extracted, 'artifact-manifest.json'), 'utf8')) as RuntimeManifest
      verifyManifest(extracted, extractedManifest)
      if (!cli.skipSmoke) smoke(extracted)
    } finally {
      rmSync(extracted, { recursive: true, force: true })
    }

    writeFileSync(
      join(cli.output, `${basename(archivePath, '.tar.gz')}.manifest.json`),
      `${JSON.stringify(manifest, undefined, 2)}\n`,
      { mode: 0o644 },
    )
    console.log(`dsh-ec2-artifact: verified ${archivePath} source=${source} platform=${target.platform} arch=${target.arch}`)
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

main()
