import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { STANDARD_GITHUB_RUNNERS, validateWorkflowSource } from './verify-ci-runner-policy'

const repositoryRoot = resolve(import.meta.dirname, '..')

describe('CI runner policy', () => {
  it('keeps the approved runner set explicit and standard-hosted', () => {
    expect([...STANDARD_GITHUB_RUNNERS]).toEqual([
      'ubuntu-latest',
      'ubuntu-24.04',
      'ubuntu-24.04-arm',
      'windows-latest',
      'windows-2025',
      'macos-latest',
    ])
  })

  it('rejects custom labels and runner arrays', () => {
    const custom = validateWorkflowSource('fixture.yml', 'jobs:\n  custom:\n    runs-on: dsh-ubuntu-24-04-16core\n  array:\n    runs-on: [self-hosted, linux]', repositoryRoot)

    expect(custom.map(violation => violation.message).join('\n')).toMatch(/forbidden custom|not an approved|runner arrays/)
  })

  it('rejects unknown dynamic selectors instead of trusting expressions', () => {
    const dynamic = validateWorkflowSource('fixture.yml', 'jobs:\n  dynamic:\n    runs-on: ${{ matrix.unknown }}\n    strategy:\n      matrix:\n        include:\n          - unknown: private-pool', repositoryRoot)

    expect(dynamic.map(violation => violation.message).join('\n')).toContain('not an approved standard')

    const generated = validateWorkflowSource('fixture.yml', 'jobs:\n  generated:\n    runs-on: ${{ matrix.runner }}\n    strategy:\n      matrix: ${{ fromJSON(needs.untrusted.outputs.matrix) }}', repositoryRoot)

    expect(generated.map(violation => violation.message).join('\n')).toContain('no statically verifiable standard values')
  })
})
