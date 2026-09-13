import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { setupHarness, type SourceTestHarness } from './helpers.ts'

const harnesses: SourceTestHarness[] = []

async function harness(options: Parameters<typeof setupHarness>[0] = {}): Promise<SourceTestHarness> {
  const value = await setupHarness(options)
  harnesses.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(value => value.dispose()))
})

const BASE_SHA = 'A'.repeat(40)
const execFileAsync = promisify(execFile)

describe('SourceController public contract', () => {
  it('publishes the source namespace and exact Remote methods', async () => {
    const { ctx } = await harness()
    expect(ctx.sourceController.typertRemote).toMatchObject({
      serviceKey: 'sourceController',
      namespace: 'source',
    })
    expect(remoteMethods(ctx.sourceController)).toEqual([
      { method: 'bootstrap', invocation: { kind: 'direct' } },
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'get', invocation: { kind: 'direct' } },
      { method: 'save', invocation: { kind: 'direct' } },
      { method: 'delete', invocation: { kind: 'direct' } },
      { method: 'publish', invocation: { kind: 'direct' } },
    ])
  })

  it('bootstraps an exact Git base without exposing host diagnostics', async () => {
    const { ctx, root, session } = await harness()
    await execFileAsync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root })
    await execFileAsync('git', ['config', 'user.name', 'source-controller-test'], { cwd: root })
    await execFileAsync('git', ['config', 'user.email', 'source-controller-test@localhost'], { cwd: root })
    await execFileAsync('git', ['commit', '--quiet', '--allow-empty', '-m', 'test base'], { cwd: root })

    const result = await ctx.sourceController.bootstrap({ sessionId: session.id })
    expect(result).toMatchObject({ ok: true, value: { baseSha: expect.stringMatching(/^[0-9a-f]{40}$/) } })
  })

  it('saves normalized drafts, fences stale writes, and rejects browser secrets', async () => {
    const { ctx, session } = await harness()
    const created = await ctx.sourceController.save({
      sessionId: session.id,
      baseSha: BASE_SHA,
      files: [
        { path: 'src/main.ts', content: 'export const main = 1\n' },
        { path: 'README.md', content: '# draft\n' },
      ],
    })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error(created.error.code)
    expect(created.value).toMatchObject({ baseSha: BASE_SHA.toLowerCase(), revision: 1 })
    expect(created.value.files.map(file => file.path)).toEqual(['README.md', 'src/main.ts'])
    expect(Object.isFrozen(created.value)).toBe(true)
    expect(Object.isFrozen(created.value.files)).toBe(true)

    const stale = await ctx.sourceController.save({
      draftId: created.value.draftId,
      sessionId: session.id,
      baseSha: BASE_SHA,
      expectedRevision: 99,
      files: [{ path: 'README.md', content: '# stale\n' }],
    })
    expect(stale).toMatchObject({ ok: false, error: { code: 'version-conflict' } })
    if (stale.ok || stale.error.code !== 'version-conflict') throw new Error('expected conflict')
    expect(stale.error.current?.revision).toBe(1)

    const updated = await ctx.sourceController.save({
      draftId: created.value.draftId,
      sessionId: session.id,
      baseSha: BASE_SHA.toLowerCase(),
      expectedRevision: 1,
      files: [{ path: 'README.md', content: '# updated\n' }],
    })
    expect(updated).toMatchObject({ ok: true, value: { revision: 2 } })

    for (const path of ['.env', '.aws/credentials', '.git/config', '../escape.ts', 'src\\escape.ts']) {
      await expect(ctx.sourceController.save({
        sessionId: session.id,
        baseSha: BASE_SHA,
        files: [{ path, content: 'secret' }],
      })).resolves.toMatchObject({ ok: false, error: { code: 'source-rejected' } })
    }
  })

  it('stores drafts, isolates Session lifecycles, and deletes with revision fencing', async () => {
    const first = await harness()
    const created = await first.ctx.sourceController.save({
      sessionId: first.session.id,
      baseSha: BASE_SHA,
      files: [{ path: 'index.ts', content: '1' }],
    })
    if (!created.ok) throw new Error(created.error.code)
    const draftId = created.value.draftId

    const listed = await first.ctx.sourceController.list({ sessionId: first.session.id })
    expect(listed).toMatchObject({ ok: true, value: { drafts: [{ draftId, revision: 1 }] } })

    const nextLifecycle = first.bootSession(first.session.id, first.session.meta.createdAt + 1)
    await expect(first.ctx.sourceController.get({ sessionId: nextLifecycle.id, draftId }))
      .resolves.toEqual({ ok: false, error: { code: 'draft-not-found', draftId } })
    await expect(first.ctx.sourceController.list({ sessionId: nextLifecycle.id }))
      .resolves.toEqual({ ok: true, value: { drafts: [] } })

    // Restore the original lifecycle identity to exercise revision-fenced
    // deletion without making the stale lifecycle visible again.
    first.bootSession(first.session.id, first.session.meta.createdAt)

    await expect(first.ctx.sourceController.delete({
      sessionId: first.session.id,
      draftId,
      expectedRevision: 99,
    })).resolves.toMatchObject({ ok: false, error: { code: 'version-conflict' } })

    await expect(first.ctx.sourceController.delete({
      sessionId: first.session.id,
      draftId,
      expectedRevision: 1,
    })).resolves.toEqual({ ok: true, value: { deleted: true } })
    await expect(first.ctx.sourceController.get({ sessionId: first.session.id, draftId }))
      .resolves.toEqual({ ok: false, error: { code: 'draft-not-found', draftId } })
  })

  it('fails closed when no host Git/PR publisher is mounted', async () => {
    const { ctx, session } = await harness()
    const saved = await ctx.sourceController.save({
      sessionId: session.id,
      baseSha: BASE_SHA,
      files: [{ path: 'index.ts', content: '1' }],
    })
    if (!saved.ok) throw new Error(saved.error.code)
    await expect(ctx.sourceController.publish({
      sessionId: session.id,
      draftId: saved.value.draftId,
      expectedRevision: saved.value.revision,
    }, new AbortController().signal)).resolves.toEqual({
      ok: false,
      error: { code: 'publisher-unavailable' },
    })
  })

  it('passes an immutable exact draft to a configured publisher', async () => {
    const publish = vi.fn(async ({ draft }: { readonly draft: unknown }) => ({
      branch: 'draft/source-test',
      commit: 'b'.repeat(40),
      pullRequestUrl: 'https://example.test/pr/1',
      draft,
    }))
    const { ctx, session } = await harness({ publisher: { publish } })
    const saved = await ctx.sourceController.save({
      sessionId: session.id,
      baseSha: BASE_SHA,
      files: [{ path: 'index.ts', content: '1' }],
    })
    if (!saved.ok) throw new Error(saved.error.code)
    const result = await ctx.sourceController.publish({
      sessionId: session.id,
      draftId: saved.value.draftId,
      expectedRevision: saved.value.revision,
    }, new AbortController().signal)
    expect(result).toEqual({
      ok: true,
      value: {
        branch: 'draft/source-test',
        commit: 'b'.repeat(40),
        pullRequestUrl: 'https://example.test/pr/1',
      },
    })
    expect(publish).toHaveBeenCalledTimes(1)
    const [call] = publish.mock.calls
    expect(call).toBeDefined()
    if (call === undefined) throw new Error('publisher was not called')
    expect(Object.isFrozen(call[0].draft)).toBe(true)
  })
})
