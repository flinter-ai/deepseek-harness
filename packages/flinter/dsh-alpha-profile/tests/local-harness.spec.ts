import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const tod = join(import.meta.dirname, '..', 'local', 'tod.py')

describe('Phase 1 local DSH_HOME rotation seam', () => {
  it('updates only the fresh-session default in an isolated home', async () => {
    const home = await mkdtemp(join(tmpdir(), 'flinter-dsh-alpha-local-'))
    try {
      const settings = join(home, 'settings.yaml')
      await writeFile(settings, [
        'agent-default-model:',
        '  model: old-model',
        '  provider: old-provider',
        '  reasoningEffort: low',
        'agent-presets:',
        '  keep: true',
        'providers:',
        '  modelflare:',
        '    apiKeyEnv: MODELFLARE_API_KEY',
        '    contextWindow: 1000000',
        '',
      ].join('\n'), { mode: 0o600 })

      await execFileAsync('python3', [tod, '--home', home, '--hour', '15'])
      const outsideArk = await readFile(settings, 'utf8')
      expect(outsideArk).toContain('  model: gpt-5.6-sol\n  provider: modelflare\n')
      expect(outsideArk).toContain('  keep: true')
      expect(outsideArk).toContain('contextWindow: 1000000')

      await execFileAsync('python3', [tod, '--home', home, '--hour', '16'])
      const insideArk = await readFile(settings, 'utf8')
      expect(insideArk).toContain('  model: ark-code-latest\n  provider: ark-agent-plan\n')
      expect(insideArk).toContain('  keep: true')
      expect(insideArk).toContain('contextWindow: 1000000')
      expect(JSON.stringify({ outsideArk, insideArk })).not.toContain('test-key')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('fails closed when the settings file has no default-model block', async () => {
    const home = await mkdtemp(join(tmpdir(), 'flinter-dsh-alpha-local-missing-'))
    try {
      const settings = join(home, 'settings.yaml')
      await writeFile(settings, 'providers: {}\n', { mode: 0o600 })
      await expect(execFileAsync('python3', [tod, '--home', home, '--hour', '16']))
        .rejects.toMatchObject({ code: 1 })
      await expect(readFile(settings, 'utf8')).resolves.toBe('providers: {}\n')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('covers every UTC hour in the script self-test', async () => {
    await expect(execFileAsync('python3', [tod, '--selftest']))
      .resolves.toMatchObject({ stdout: expect.stringContaining('24/24 UTC hours covered') })
  })
})
