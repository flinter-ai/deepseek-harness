import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const originalEnvironment = { DSH_HOME: process.env.DSH_HOME, DSH_TELEMETRY_DISABLED: process.env.DSH_TELEMETRY_DISABLED }

afterEach(() => {
  if (originalEnvironment.DSH_HOME === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalEnvironment.DSH_HOME
  if (originalEnvironment.DSH_TELEMETRY_DISABLED === undefined) delete process.env.DSH_TELEMETRY_DISABLED
  else process.env.DSH_TELEMETRY_DISABLED = originalEnvironment.DSH_TELEMETRY_DISABLED
})

describe('Phase 1 AWS profile loader', () => {
  it('boots the real profile loader and resolves a credential through a mocked Secrets Manager', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flinter-dsh-aws-profile-'))
    const profile = join(root, 'profiles', 'aws-worker')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      name: 'dsh-profile-aws-worker-test',
      private: true,
      dsh: {
        profile: {
          // The loader seam is tested without a one-shot app argument. The
          // existing process E2E covers base + headless task execution.
          bundles: ['@deepseek-ai/dsh-base'],
          patchReload: 'startup',
        },
      },
    }) + '\n')
    await writeFile(join(profile, 'cordis.patch.yml'), [
      '- id: credentials',
      '  disabled: true',
      '- insert:',
      '    - id: credentials-aws-secrets-manager',
      "      name: '@deepseek-ai/dsh-credentials-aws-secrets-manager'",
      '      config:',
      '        secretNames:',
      '          ARK_PLAN_API_KEY: flinter/dsh-ark-agent-plan',
      '        secretFormat: json',
      '        allowWrites: false',
      '',
    ].join('\n'))
    process.env.DSH_HOME = root
    process.env.DSH_TELEMETRY_DISABLED = '1'
    const resultPath = join(root, 'loader-result.json')
    const result = await execa(process.execPath, [
      '--import', 'tsx/esm',
      join(import.meta.dirname, 'fixtures/aws-profile-loader.ts'),
    ], {
      cwd: join(import.meta.dirname, '../../../..'),
      env: {
        DSH_HOME: root,
        DSH_TELEMETRY_DISABLED: '1',
        DSH_AWS_RESULT_FILE: resultPath,
        AWS_REGION: 'us-east-1',
        TSX_TSCONFIG_PATH: join(import.meta.dirname, '../../../..', 'tsconfig.base.json'),
      },
      extendEnv: false,
      reject: false,
      timeout: 30_000,
    })
    try {
      expect(result.exitCode, result.stderr).toBe(0)
      expect(result.stdout).not.toContain('mock-aws-value')
      await expect(readFile(resultPath, 'utf8')).resolves.toBe(
        '{"resolved":{"value":"mock-aws-value","source":"aws-secrets-manager"},"info":{"configured":true,"source":"aws-secrets-manager","writable":false}}',
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
