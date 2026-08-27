import { execFileSync } from 'node:child_process'
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
})
