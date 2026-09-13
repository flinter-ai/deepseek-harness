import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

describe('public AWS worker profile bundle', () => {
  it('is a thin credential overlay over the shared DSH composition', () => {
    const manifest = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as {
      private?: boolean
      publishConfig?: { access?: string }
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.private).not.toBe(true)
    expect(manifest.publishConfig?.access).toBe('public')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')

    const patch = load(readFileSync(`${root}/cordis.patch.yml`, 'utf8')) as Array<Record<string, unknown>>
    expect(patch).toMatchObject([
      { id: 'credentials', disabled: true },
      {
        insert: [{
          id: 'credentials-aws-secrets-manager',
          name: '@deepseek-ai/dsh-credentials-aws-secrets-manager',
          config: {
            secretFormat: 'json',
            allowWrites: false,
            secretNames: {
              ARK_PLAN_API_KEY: 'flinter/dsh-ark-agent-plan',
              MODELFLARE_API_KEY: 'flinter/dsh-modelflare',
              GMI_SERVING_API_KEY: 'flinter/dsh-gmi-serving',
              DEEPSEEK_API_KEY: 'flinter/dsh-deepseek-official',
            },
          },
        }],
      },
    ])
    expect(JSON.stringify(patch)).not.toMatch(/(?:sk-|mock-value|Bearer\s)/i)
  })
})
