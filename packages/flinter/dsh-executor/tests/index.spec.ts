import { describe, expect, it } from 'vitest'
import { SCAFFOLD_STATUS } from '../src/index.ts'

describe('@flinter/dsh-executor scaffold', () => {
  it('is explicitly non-loaded', () => {
    expect(SCAFFOLD_STATUS).toBe('SCAFFOLD_ONLY')
  })
})
