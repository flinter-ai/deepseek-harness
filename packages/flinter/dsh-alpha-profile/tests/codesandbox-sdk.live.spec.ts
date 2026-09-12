import { describe, expect, it } from 'vitest'
import { CodeSandboxComputeBackend, CodeSandboxSdkRuntime } from '../src/index.ts'

describe.skipIf(!process.env.CSB_API_KEY)('live CodeSandbox SDK runtime', () => {
  it('creates, executes, and shuts down one bounded no-credential worker VM', async () => {
    const backend = new CodeSandboxComputeBackend({
      runtime: new CodeSandboxSdkRuntime({
        title: 'DSH live compute smoke',
        description: 'Ephemeral smoke test; no provider credentials',
        tags: ['dsh', 'live-smoke'],
      }),
      vmTier: 'pico',
      hibernationTimeoutSeconds: 300,
    })
    const running = await backend.start({
      sessionId: 'live-session',
      attemptId: 'attempt-0',
      argv: ['/usr/bin/printf', 'dsh-codesandbox-sdk-live-ok\\n'],
      cwd: '/project/sandbox',
      env: {
        DSH_COMPUTE_BACKEND: 'codesandbox',
        DSH_CALLBACK_HMAC_SECRET_REF: 'ref-only',
      },
    })

    await expect(running.waitUntilComplete()).resolves.toContain('dsh-codesandbox-sdk-live-ok')
  }, 120_000)
})
