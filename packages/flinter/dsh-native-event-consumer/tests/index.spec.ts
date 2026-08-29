import { describe, expect, it } from 'vitest'
import { SCAFFOLD_STATUS } from '../src/index.ts'

describe('@flinter/dsh-native-event-consumer scaffold', () => {
  it('is explicitly non-loaded', () => {
    expect(SCAFFOLD_STATUS).toBe('SCAFFOLD_ONLY')
  })
})
