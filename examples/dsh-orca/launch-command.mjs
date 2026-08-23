import { join } from 'node:path'

/**
 * Build the shell invocation for one headless DSH worker without interpolating
 * the task text into shell source.
 *
 * @param {object} options
 * @returns {{ file: string, args: string[], env: NodeJS.ProcessEnv }}
 */
export function buildDshLaunchCommand({
  home,
  profile,
  taskSpec,
  orcaEnv,
  dshRoot,
  nodeBin,
  cwd,
  gmiEnv,
  inheritedEnv = process.env,
}) {
  const env = {
    ...inheritedEnv,
    ...Object.fromEntries(Object.entries(orcaEnv).filter(([, value]) => value !== undefined)),
    PATH: `${nodeBin}:${inheritedEnv.PATH ?? ''}`,
    DSH_HOME: home,
    TSX_TSCONFIG_PATH: join(dshRoot, 'tsconfig.base.json'),
    DSH_AGENT_CWD: cwd,
    DSH_AGENT_NODE: join(nodeBin, 'node'),
    DSH_AGENT_TSX_IMPORT: join(dshRoot, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs'),
    DSH_AGENT_CLI: join(dshRoot, 'apps', 'cli', 'src', 'bin.ts'),
    DSH_AGENT_PROFILE: profile,
    DSH_TASK_SPEC: String(taskSpec ?? ''),
    ...(gmiEnv ? { DSH_AGENT_GMI_ENV: gmiEnv } : {}),
  }
  const sourceGmi = gmiEnv ? 'source "$DSH_AGENT_GMI_ENV" && ' : ''
  const script = `${sourceGmi}cd "$DSH_AGENT_CWD" && exec "$DSH_AGENT_NODE" --import "$DSH_AGENT_TSX_IMPORT" "$DSH_AGENT_CLI" --profile "$DSH_AGENT_PROFILE" "$DSH_TASK_SPEC"`
  return { file: 'bash', args: ['-c', script], env }
}
