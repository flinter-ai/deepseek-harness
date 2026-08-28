import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { quoteShell } from '../quote-shell.mjs'

describe('quoteShell (outer Orca --command boundary)', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  // --- pure unit tests for the escape pattern ---

  it('wraps a benign value in single quotes', () => {
    expect(quoteShell('abc')).toBe("'abc'")
    expect(quoteShell('')).toBe("''")
    expect(quoteShell('/tmp/dsh')).toBe("'/tmp/dsh'")
  })

  it('escapes embedded single quotes by closing, escaping, and reopening', () => {
    // ' → '\''  (close, escaped quote, reopen) — the canonical POSIX form.
    expect(quoteShell("o'clock")).toBe("'o'\\''clock'")
    expect(quoteShell("''")).toBe("''\\'''\\'''")
    expect(quoteShell("'a'b'c'")).toBe("''\\''a'\\''b'\\''c'\\'''")
  })

  it('preserves shell metacharacters literally — no expansion inside single quotes', () => {
    // Every input here is something bash would evaluate if quoteShell were
    // absent or used the wrong escape. The function must round-trip the
    // original string with the only change being the surrounding ' and any
    // ' → '\'' substitutions.
    const adversarial = [
      '$VAR',
      '$USER',
      '${HOME}',
      '$(touch /tmp/MARKER)',
      '$(id)',
      '`touch /tmp/MARKER`',
      '`whoami`',
      '"; touch /tmp/MARKER; "',
      "' ; touch /tmp/MARKER ; '",
      '|rm -rf /',
      '&& touch /tmp/MARKER &&',
      '|| true',
      'a b c',
      'a\nb',
      'a\tb',
      'a\\b',
      '> /etc/passwd',
      '< /etc/shadow',
    ]
    for (const input of adversarial) {
      const result = quoteShell(input)
      // First and last chars must be the single quotes POSIX requires for a
      // single-quoted string; everything else must round-trip through the
      // '\'\' escape pattern.
      expect(result.startsWith("'")).toBe(true)
      expect(result.endsWith("'")).toBe(true)
      const unescaped = result.slice(1, -1).replace(/'\\''/g, "'")
      expect(unescaped).toBe(input)
    }
  })

  // --- end-to-end: a real shell evaluating the constructed Orca --command
  //     must produce no side effects and must deliver the literal value ---

  // This is the OUTER shell that the user explicitly called out as
  // untested: spawn-dsh-worker.mjs builds a `node <DSH_AGENT> --model ...`
  // string and hands it to Orca's `terminal create --command`. Orca parses
  // the string with its own shell before exec'ing node. Anything the inner
  // single quotes fail to escape here executes before the worker ever
  // starts. The inner dsh-agent boundary is covered by launch-command.spec;
  // this is the layer above it.
  it('built Orca --command runs through sh with no expansion and no side effect', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-orca-outer-'))
    roots.push(root)
    const markerA = join(root, 'backtick-ran')
    const markerB = join(root, 'substitution-ran')
    const markerC = join(root, 'quote-ran')

    // Adversarial values that, if unquoted, would each cause a side effect.
    // These are the same shapes the inner dsh-agent boundary proves safe;
    // the outer shell must prove them safe too, because the bash that parses
    // the Orca --command is a different bash than the one that parses the
    // inner script.
    const tmpRoot = '`touch ' + markerA + '`'
    const artifactRoot = '$(touch ' + markerB + ')'
    const dshRoot = "'; touch " + markerC + " ; '"
    const model = 'easy'
    // dshAgent points to a path that does not exist on purpose: the test
    // asserts the shell never even gets as far as `node`, because the
    // adversarial side-effect shapes would have run before node starts.
    const dshAgent = join(root, 'no-such-dsh-agent.mjs')

    // Construct the command the same way spawn-dsh-worker.mjs does at
    // line 162 of that file. If the production site drifts, this test must
    // drift with it.
    const command = `node ${quoteShell(dshAgent)} --model ${quoteShell(model)} --tmp-root ${quoteShell(tmpRoot)} --artifact-root ${quoteShell(artifactRoot)} --dsh-root ${quoteShell(dshRoot)}`

    // Run the command through a real shell. The exit code will be non-zero
    // because the node target does not exist, but the side effects are what
    // we are checking. spawnSync (not execFileSync) so a non-zero exit does
    // not throw and pre-empt the assertions.
    const result = spawnSync('sh', ['-c', command], { stdio: 'pipe' })
    expect(result.status).not.toBe(0) // sanity: the dsh-agent target was missing

    expect(existsSync(markerA)).toBe(false)
    expect(existsSync(markerB)).toBe(false)
    expect(existsSync(markerC)).toBe(false)
  })

  // Round-trip: spawn a fake dsh-agent that records argv, verify the
  // quoted adversarial values arrive at the worker as literal argv, and
  // that no side-effect payloads evaluated during shell parsing.
  it('quoted adversarial values arrive at the spawned process as literal argv', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-orca-outer-'))
    roots.push(root)
    const captureOut = join(root, 'argv.json')

    const fakeAgent = join(root, 'dsh-agent.mjs')
    // The dsh-orca package declares `"type": "module"`, so the parent
    // directory of this tmpfile is ESM at runtime. Use ESM syntax here too —
    // `require` would ReferenceError.
    writeFileSync(fakeAgent, [
      '#!/usr/bin/env node',
      "import { writeFileSync } from 'node:fs'",
      'const argv = process.argv.slice(2)',
      'const out = {}',
      'for (let i = 0; i < argv.length; i++) {',
      '  if (argv[i] === "--tmp-root" || argv[i] === "--artifact-root" || argv[i] === "--dsh-root" || argv[i] === "--model") {',
      '    out[argv[i].slice(2)] = argv[i + 1]',
      '  }',
      '}',
      'writeFileSync(process.env.CAPTURE_OUT, JSON.stringify(out))',
      '',
    ].join('\n'))
    chmodSync(fakeAgent, 0o755)

    const adversarialTmp = "'; touch /tmp/MARKER_OUTER_TMP; #"
    const adversarialArtifact = '`whoami`'
    const adversarialDsh = '$(id)'

    const command = `node ${quoteShell(fakeAgent)} --model ${quoteShell('easy')} --tmp-root ${quoteShell(adversarialTmp)} --artifact-root ${quoteShell(adversarialArtifact)} --dsh-root ${quoteShell(adversarialDsh)}`

    execFileSync('sh', ['-c', command], { stdio: 'pipe', env: { ...process.env, CAPTURE_OUT: captureOut } })

    const captured = JSON.parse(readFileSync(captureOut, 'utf8'))
    expect(captured['tmp-root']).toBe(adversarialTmp)
    expect(captured['artifact-root']).toBe(adversarialArtifact)
    expect(captured['dsh-root']).toBe(adversarialDsh)
  })
})
