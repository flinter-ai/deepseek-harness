import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { SELF_HOSTED_LINUX_RUNNER, STANDARD_GITHUB_RUNNERS, validateWorkflowSource } from './verify-ci-runner-policy'

const repositoryRoot = resolve(import.meta.dirname, '..')

describe('CI runner policy', () => {
  it('keeps the approved platform-exception runner set explicit', () => {
    expect([...STANDARD_GITHUB_RUNNERS]).toEqual([
      'ubuntu-24.04-arm',
      'windows-latest',
      'windows-2025',
      'macos-latest',
    ])
  })

  it('rejects hosted Linux x64 labels', () => {
    const violations = validateWorkflowSource('fixture.yml', `jobs:
  latest:
    runs-on: ubuntu-latest
  stable:
    runs-on: ubuntu-24.04`, repositoryRoot)

    expect(violations).toHaveLength(2)
    expect(violations.map(violation => violation.message).join('\n')).toMatch(
      /not an approved hosted label or self-hosted label/,
    )
  })

  it('accepts only the exact self-hosted Linux selector', () => {
    const accepted = validateWorkflowSource('fixture.yml', `jobs:\n  direct:\n    runs-on: [${SELF_HOSTED_LINUX_RUNNER.join(', ')}]\n  matrix:\n    runs-on: \${{ matrix.runner }}\n    strategy:\n      matrix:\n        include:\n          - runner: ci-linux`, repositoryRoot)

    expect(accepted).toEqual([])
  })

  it('rejects custom labels and incomplete runner arrays', () => {
    const custom = validateWorkflowSource('fixture.yml', 'jobs:\n  custom:\n    runs-on: dsh-ubuntu-24-04-16core\n  array:\n    runs-on: [self-hosted, linux]', repositoryRoot)

    expect(custom.map(violation => violation.message).join('\n')).toMatch(/forbidden custom|not an approved|exact self-hosted/)
  })

  it('rejects unknown dynamic selectors instead of trusting expressions', () => {
    const dynamic = validateWorkflowSource('fixture.yml', 'jobs:\n  dynamic:\n    runs-on: ${{ matrix.unknown }}\n    strategy:\n      matrix:\n        include:\n          - unknown: private-pool', repositoryRoot)

    expect(dynamic.map(violation => violation.message).join('\n')).toContain('not an approved hosted label')

    const generated = validateWorkflowSource('fixture.yml', 'jobs:\n  generated:\n    runs-on: ${{ matrix.runner }}\n    strategy:\n      matrix: ${{ fromJSON(needs.untrusted.outputs.matrix) }}', repositoryRoot)

    expect(generated.map(violation => violation.message).join('\n')).toContain('no statically verifiable standard values')
  })
})
