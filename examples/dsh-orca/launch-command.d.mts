export interface DshLaunchCommandOptions {
  home: string
  profile: string
  taskSpec: unknown
  orcaEnv: Record<string, string | undefined>
  dshRoot: string
  nodeBin: string
  cwd: string
  gmiEnv: string | null
  /** Attempt artifact root exported as DSH_ORCA_ARTIFACT_ROOT; omitted when absent. */
  artifacts?: string
  inheritedEnv?: NodeJS.ProcessEnv
}

export interface DshLaunchCommand {
  file: string
  args: string[]
  env: NodeJS.ProcessEnv
}

export function buildDshLaunchCommand(options: DshLaunchCommandOptions): DshLaunchCommand
