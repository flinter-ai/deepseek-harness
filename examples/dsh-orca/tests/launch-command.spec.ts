import { execFileSync, spawnSync } from 'node:child_process'
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

  // Behavioral regression guard. The earlier literal-regex test
  // (`/export ${/` and `/JSON\.stringify\(taskSpec\)/`) only fired on the
  // exact two patterns it knew about. Plant any other interpolation and it
  // stays green while the worker gets exploited. This test executes the
  // launcher with a task that contains backticks, $(...), $VAR, and shell
  // metacharacters, then asserts (a) the embedded payload never reached the
  // child as shell source and (b) no marker files were created. It is the
  // test that would have caught a planted `export PATH="${nodeBin}:$PATH"`
  // builder or any other interpolation pattern.
  it('behavioral: a malicious task runs no side effects and is delivered to the worker as one literal argv', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-orca-inject-'))
    roots.push(root)
    const argvCapture = join(root, 'argv.json')
    const markerBacktick = join(root, 'backtick-fired')
    const markerSubshell = join(root, 'subshell-fired')
    const markerVar = join(root, 'var-fired')
    const markerRedirect = join(root, 'redirect-fired')
    // The four shapes an attacker who controls the task text can try.
    const malicious = [
      `; touch ${markerBacktick} ; `,
      `\`touch ${markerSubshell}\``,
      `$(touch ${markerVar})`,
      `' > ${markerRedirect} #`,
    ].join(' / report $USER / ')
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
      taskSpec: malicious,
      orcaEnv: { DSH_ORCA_TASK_ID: 'task_inject' },
      dshRoot: join(root, 'harness'),
      nodeBin: root,
      cwd: root,
      gmiEnv: null,
      inheritedEnv: { ...process.env, CAPTURE_OUTPUT: argvCapture },
    })
    const result = spawnSync(launch.file, launch.args, { env: launch.env, encoding: 'utf8' })
    expect(result.status).toBe(0)

    const argv = JSON.parse(readFileSync(argvCapture, 'utf8')) as string[]
    // The whole malicious string must arrive at the worker as one argv slot,
    // unexpanded. Anything less is shell evaluation we let through.
    expect(argv.at(-1)).toBe(malicious)
    expect(argv).toContain(malicious)
    // The script body is the only place a shell would see $USER or $(). The
    // capture.sh sees only the final argv via exec, so an injection would
    // show up as a marker file. None may exist.
    for (const marker of [markerBacktick, markerSubshell, markerVar, markerRedirect]) {
      expect(existsSync(marker)).toBe(false)
    }
  })

  it('dsh-agent.mjs launches the worker through buildDshLaunchCommand, never a string-built bash script', () => {
    // The behavioral test above proves the launcher is safe on a real
    // malicious task. This companion guard ensures the wiring that USES the
    // launcher is still pointing at it — a future refactor that swaps
    // buildDshLaunchCommand for a string-built script would otherwise pass
    // the behavioral test in isolation while shipping a vulnerable
    // dsh-agent. We assert the wiring rather than a literal pattern, so
    // re-introducing an interpolation under any name (export PATH=...,
    // ${VAR}, JSON.stringify(taskSpec), template literals) is caught by
    // the behavioral test, not by a regex that the new builder can dodge.
    const agent = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dsh-agent.mjs'),
      'utf8',
    )
    expect(agent).toContain('buildDshLaunchCommand')
    expect(agent).toContain('spawn(launch.file, launch.args, { env: launch.env')
  })

  // Script-body invariant. The behavioral test above proves a malicious
  // task does not get shell-evaluated. This one pins the script body to
  // an exact string, so any future edit that interpolates a value,
  // inserts a side effect, or changes the argv structure fails here. The
  // script is the only boundary where shell evaluation could reach a
  // caller-supplied value; the string-equality check is the regression
  // guard.
  it('script body is pinned to a fixed, caller-invariant string', () => {
    const SCRIPT_NO_GMI = 'cd "$DSH_AGENT_CWD" && exec "$DSH_AGENT_NODE" --import "$DSH_AGENT_TSX_IMPORT" "$DSH_AGENT_CLI" --profile "$DSH_AGENT_PROFILE" "$DSH_TASK_SPEC"'
    const SCRIPT_WITH_GMI = `source "$DSH_AGENT_GMI_ENV" && ${SCRIPT_NO_GMI}`
    const benign = buildDshLaunchCommand({
      home: '/tmp/home', profile: 'headless', taskSpec: 'just do the thing',
      orcaEnv: {}, dshRoot: '/tmp/harness', nodeBin: '/tmp/bin',
      cwd: '/tmp', gmiEnv: null, inheritedEnv: {},
    })
    const malicious = buildDshLaunchCommand({
      home: '/tmp/home/$(rm -rf /)', profile: 'headless`touch /tmp/pwn`',
      taskSpec: '`touch /tmp/pwn2` $(touch /tmp/pwn3) $EVIL',
      orcaEnv: { DSH_ORCA_TASK_ID: 'x`touch /tmp/pwn4`' },
      dshRoot: '/tmp/harness"$(touch /tmp/pwn5)"',
      nodeBin: '/tmp/bin/$(touch /tmp/pwn6)', cwd: '/tmp`touch /tmp/pwn7`',
      gmiEnv: null, inheritedEnv: {},
    })
    const withGmi = buildDshLaunchCommand({
      home: '/tmp/home', profile: 'headless', taskSpec: 'task',
      orcaEnv: {}, dshRoot: '/tmp/harness', nodeBin: '/tmp/bin',
      cwd: '/tmp', gmiEnv: '/tmp/gmi.env', inheritedEnv: {},
    })
    expect(benign.args[1]).toBe(SCRIPT_NO_GMI)
    expect(malicious.args[1]).toBe(SCRIPT_NO_GMI)
    expect(withGmi.args[1]).toBe(SCRIPT_WITH_GMI)
  })
})
