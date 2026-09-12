/** Keyless lifecycle probe for the built profile launcher. */
import { LlmAdapter } from '@deepseek-ai/dsh-llm'

export const inject = ['llm', 'agentDefaultModel']

/** Mount a plain adapter and observe launcher readiness and disposal. */
export function apply(ctx) {
  if (process.env.DSH_TEST_SKIP_ADAPTER !== '1') {
    ctx.llm.registerAdapter(['readiness-test'], new class extends LlmAdapter {
      stream() { throw new Error('readiness must not generate') }
    }())
  }
  const keepAlive = setInterval(() => {}, 1000)
  ctx.effect(() => async () => {
    clearInterval(keepAlive)
    process.stdout.write('READINESS_DISPOSED\n')
    if (process.env.DSH_TEST_DISPOSER === 'throw') throw new Error('READINESS_DISPOSE_FAILED')
    if (process.env.DSH_TEST_DISPOSER === 'hang') await new Promise(() => {})
  })
  ctx.appReady.onReady(() => {
    process.stdout.write('READINESS_COMMITTED\n')
    ctx.appExit(0)
  })
}
