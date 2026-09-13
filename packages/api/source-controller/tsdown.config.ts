import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-api-source-controller',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { hostPhase: true },
)
