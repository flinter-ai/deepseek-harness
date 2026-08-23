/**
 * Shared profile materialization for the aws-headless keyless smokes: copy the
 * checked-in template into a temp DSH_HOME and link packages that sit outside
 * the app/bundle dependency closure — the same mechanism
 * `dsh plugin --profile aws-headless add <path>` uses.
 */

import { copyFile, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
/** The checked-in profile template the smokes materialize into a temp DSH_HOME. */
const PROFILE_TEMPLATE = fileURLToPath(new URL('../profile/', import.meta.url))
export const INSTALL_ANCHOR = join(REPO_ROOT, 'apps/cli/package.json')
export const CLI_BIN = join(REPO_ROOT, 'apps/cli/src/bin.ts')
export const TSCONFIG = join(REPO_ROOT, 'tsconfig.json')

/**
 * Copy the template into `<home>/profiles/aws-headless` and link the two
 * profile packages outside the dependency closure.
 * @param home - the temporary DSH_HOME.
 * @param options - `enginePin: false` rewrites the user patch so the dsh-pes
 *   row mounts WITHOUT the engine_pin block — a failure-classification
 *   fixture proving the runtime driver exits nonzero for malformed provenance
 *   (production always pins the immutable producer SHA).
 * @returns the materialized profile directory.
 */
export async function materializeProfile(home: string, options: { enginePin?: boolean } = {}): Promise<string> {
  const { enginePin = true } = options
  const profileDir = join(home, 'profiles', 'aws-headless')
  await mkdir(join(profileDir, 'node_modules', '@flinter'), { recursive: true })
  await mkdir(join(profileDir, 'node_modules', '@deepseek-ai'), { recursive: true })
  await copyFile(join(PROFILE_TEMPLATE, 'package.json'), join(profileDir, 'package.json'))
  let patchText = await readFile(join(PROFILE_TEMPLATE, 'cordis.patch.yml'), 'utf8')
  if (!enginePin) {
    patchText = patchText.replace(
      /# The dsh-pes bundle mounts the searchable-trace plugin[\s\S]*?engine_pin: '[0-9a-f]{40}'\n/,
      '# Failure-classification fixture: the dsh-pes row mounts WITHOUT the\n'
      + '# engine_pin pin, so the runtime driver must exit nonzero for malformed\n'
      + '# provenance (production always pins the immutable producer SHA).\n'
      + '- id: dsh-pes\n',
    )
  }
  await writeFile(join(profileDir, 'cordis.patch.yml'), patchText)
  await symlink(join(REPO_ROOT, 'examples/dsh-orca'), join(profileDir, 'node_modules', '@flinter', 'dsh-orca'), 'dir')
  await linkProfilePackage(profileDir, '@flinter', 'dsh-segment', join(REPO_ROOT, 'examples/dsh-segment'))
  await linkProfilePackage(profileDir, '@flinter', 'dsh-pes', join(REPO_ROOT, 'examples/dsh-pes'))
  await linkProfilePackage(
    profileDir,
    '@deepseek-ai',
    'dsh-credentials-aws-secrets-manager',
    join(REPO_ROOT, 'packages/credentials/dsh-credentials-aws-secrets-manager'),
  )
  await writeFile(join(profileDir, 'cordis.yml'), '[]\n')
  return profileDir
}

/**
 * Link one additional workspace package into a materialized profile's
 * node_modules.
 * @param profileDir - the materialized profile directory.
 * @param scope - npm scope directory (e.g. `@deepseek-ai`).
 * @param name - package name within the scope.
 * @param packageDir - absolute path of the workspace package.
 */
export async function linkProfilePackage(
  profileDir: string,
  scope: string,
  name: string,
  packageDir: string,
): Promise<void> {
  await mkdir(join(profileDir, 'node_modules', scope), { recursive: true })
  await symlink(packageDir, join(profileDir, 'node_modules', scope, name), 'dir')
}

/**
 * Prove activation needs nothing from AWS: strip every credential/region
 * source and disable IMDS, so any AWS call during boot would fail loud
 * instead of borrowing the developer's credential chain.
 * @param home - the temporary DSH_HOME pinned into the environment.
 * @returns a restore function that puts the process environment back exactly.
 */
export function sanitizeAwsEnv(home: string): () => void {
  const saved = { ...process.env }
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('AWS_')) Reflect.deleteProperty(process.env, key)
  }
  process.env.AWS_EC2_METADATA_DISABLED = 'true'
  process.env.DSH_HOME = home
  return () => {
    for (const key of Object.keys(process.env)) Reflect.deleteProperty(process.env, key)
    Object.assign(process.env, saved)
  }
}
