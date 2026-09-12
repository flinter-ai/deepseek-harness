/** Built CLI startup contract; no live settings, credentials, or generation. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'

const srcBin = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const fixture = pathToFileURL(fileURLToPath(new URL('./fixtures/default-model-readiness.mjs', import.meta.url))).href

describe('default model startup', () => {
  async function launch(options: { off?: boolean; skipAdapter?: boolean; disposer?: 'throw' | 'hang' }) {
    const home = await mkdtemp(join(tmpdir(), 'dsh-model-ready-'))
    try {
      const profile = join(home, 'profiles', 'probe')
      await mkdir(profile, { recursive: true })
      await writeFile(join(profile, 'package.json'), JSON.stringify({
        name: 'dsh-profile-probe', private: true, dependencies: {},
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
      }))
      await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([
        { insert: [{ id: 'readiness-probe', name: fixture }] },
      ]))
      await writeFile(join(home, 'settings.yaml'), JSON.stringify({
        'agent-default-model': {
          provider: 'readiness-test', model: 'plain', ...(options.off ? { reasoningEffort: 'off' } : {}),
        },
      }))
      const launch = resolveExampleLaunch({
        srcBin, tsconfigPath, configArgs: ['--profile', 'probe'],
      })
      return await execa(launch.command, launch.args, {
        cwd: home, extendEnv: false,
        env: {
          PATH: process.env.PATH, ...launch.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1',
          ...(options.skipAdapter ? { DSH_TEST_SKIP_ADAPTER: '1' } : {}),
          ...(options.disposer ? { DSH_TEST_DISPOSER: options.disposer } : {}),
        },
        timeout: 20_000, killSignal: 'SIGKILL', reject: false,
      })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  }

  it.each([false, true])('validates saved selection before readiness (stale off: %s)', async (off) => {
    const result = await launch({ off })
    expect(result.timedOut).toBe(false)
    expect(result.stdout).toContain('READINESS_DISPOSED')
    if (off) {
      expect(result.exitCode).not.toBe(0)
      expect(result.stdout).not.toContain('READINESS_COMMITTED')
      expect(result.stderr).toContain('UNSUPPORTED_REASONING_EFFORT')
    } else {
      expect(result.exitCode, result.stderr).toBe(0)
      expect(result.stdout).toContain('READINESS_COMMITTED')
    }
  })

  it('boots with an unroutable saved provider so the UI can repair it', async () => {
    const result = await launch({ skipAdapter: true })
    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.stdout).toContain('READINESS_COMMITTED')
  })

  it.each(['throw', 'hang'] as const)('preserves the validation error through a %s disposer', async (disposer) => {
    const result = await launch({ off: true, disposer })
    expect(result.timedOut).toBe(false)
    expect(result.exitCode).not.toBe(0)
    expect(result.stdout).not.toContain('READINESS_COMMITTED')
    expect(result.stderr).toContain('UNSUPPORTED_REASONING_EFFORT')
  })
})
