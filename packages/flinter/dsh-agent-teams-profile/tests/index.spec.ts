import { describe, expect, it } from 'vitest'
import { PROFILE_STATUS } from '../src/index.ts'

describe('@flinter/dsh-agent-teams-profile scaffold', () => {
  it('is explicitly non-loaded', () => {
    expect(PROFILE_STATUS).toBe('SCAFFOLD_ONLY')
  })
})
