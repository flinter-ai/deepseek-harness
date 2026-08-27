import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { buildDshLaunchCommand } from '../launch-command.mjs'

describe('dsh-orca worker launch command', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('passes task text as one literal argument without shell evaluation', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-orca-launch-'))
    roots.push(root)
    const output = join(root, 'argv.json')
    const markerA = join(root, 'backtick-ran')
    const markerB = join(root, 'substitution-ran')
    const task = `inspect \`touch ${markerA}\` and $(touch ${markerB}) literally`
    writeFileSync(
      join(root, 'capture.sh'),
      `#!/bin/bash\n${JSON.stringify(process.execPath)} -e "require('fs').writeFileSync(process.env.CAPTURE_OUTPUT, JSON.stringify(process.argv.slice(1)))" -- "$@"\n`,
    )
    chmodSync(join(root, 'capture.sh'), 0o755)
    writeFileSync(join(root, 'node'), `#!/bin/bash\nexec ${JSON.stringify(join(root, 'capture.sh'))} "$@"\n`)
    chmodSync(join(root, 'node'), 0o755)

    const launch = buildDshLaunchCommand({
      home: join(root, 'home'),
      profile: 'headless',
      taskSpec: task,
      orcaEnv: { DSH_ORCA_TASK_ID: 'task_test' },
      dshRoot: join(root, 'harness'),
      nodeBin: root,
      cwd: root,
      gmiEnv: null,
      inheritedEnv: { ...process.env, CAPTURE_OUTPUT: output },
    })
    execFileSync(launch.file, launch.args, { env: launch.env })

    const argv = JSON.parse(readFileSync(output, 'utf8')) as string[]
    expect(argv.at(-1)).toBe(task)
    expect(existsSync(markerA)).toBe(false)
    expect(existsSync(markerB)).toBe(false)
    expect(launch.args.join(' ')).not.toContain(task)
  })

  it('exports the attempt artifact root through the environment, not the script', () => {
    const launch = buildDshLaunchCommand({
      home: '/tmp/home',
      profile: 'headless',
      taskSpec: 'task',
      orcaEnv: {},
      dshRoot: '/tmp/harness',
      nodeBin: '/tmp/bin',
      cwd: '/tmp',
      gmiEnv: null,
      artifacts: '/tmp/artifacts/run/task',
      inheritedEnv: {},
    })
    expect(launch.env.DSH_ORCA_ARTIFACT_ROOT).toBe('/tmp/artifacts/run/task')
    expect(launch.args.join(' ')).not.toContain('/tmp/artifacts/run/task')
  })

  it('omits the artifact root when no attempt paths were created', () => {
    const launch = buildDshLaunchCommand({
      home: '/tmp/home',
      profile: 'headless',
      taskSpec: 'task',
      orcaEnv: {},
      dshRoot: '/tmp/harness',
      nodeBin: '/tmp/bin',
      cwd: '/tmp',
      gmiEnv: null,
      inheritedEnv: {},
    })
    expect('DSH_ORCA_ARTIFACT_ROOT' in launch.env).toBe(false)
  })

  // Regression guard. An earlier reliability branch rebuilt the launch as an
  // interpolated shell string (`export K="${v}"` plus JSON.stringify(task));
  // JSON quoting is not shell quoting, so `$USER` and backticks in a task were
  // evaluated by bash. Merging that branch on top of this one silently undid
  // the fix. This asserts the launcher never regains a shell-source builder.
  it('dsh-agent builds no shell source from task or env values', () => {
    const agent = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dsh-agent.mjs'),
      'utf8',
    )
    expect(agent).toContain('buildDshLaunchCommand')
    expect(agent).not.toMatch(/export \$\{/)
    expect(agent).not.toMatch(/JSON\.stringify\(taskSpec\)/)
  })
})
