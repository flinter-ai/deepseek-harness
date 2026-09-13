import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { SourceDraftModel, type ISourceDrafts } from '../src/client/index.ts'
import type {
  SourceDraft,
  SourceDraftId,
  SourceDraftSaveResult,
} from '../src/types.ts'

const SESSION_ID = 'session-source-model' as SessionId
const BASE_SHA = 'a'.repeat(40)

function draft(revision: number, content: string): SourceDraft {
  return {
    draftId: 'draft-source-model' as SourceDraftId,
    sessionId: SESSION_ID,
    baseSha: BASE_SHA,
    files: Object.freeze([{ path: 'index.ts', content }]),
    revision,
    createdAt: 1,
    updatedAt: revision,
  }
}

function saveResult(value: SourceDraft): RemoteResult<SourceDraftSaveResult> {
  return { ok: true, value: { ok: true, value } }
}

function remote(): {
  readonly value: ISourceDrafts
  readonly save: ReturnType<typeof vi.fn>
  readonly publish: ReturnType<typeof vi.fn>
} {
  const save = vi.fn()
  const publish = vi.fn()
  return {
    save,
    publish,
    value: {
      list: vi.fn(),
      get: vi.fn(),
      save,
      delete: vi.fn(),
      publish,
    } as unknown as ISourceDrafts,
  }
}

describe('SourceDraftModel', () => {
  it('serializes saves and keeps newer editor files dirty while an older save settles', async () => {
    let release!: (result: RemoteResult<SourceDraftSaveResult>) => void
    const first = new Promise<RemoteResult<SourceDraftSaveResult>>((resolve) => { release = resolve })
    const service = remote()
    service.save.mockReturnValueOnce(first).mockResolvedValueOnce(saveResult(draft(2, 'two')))
    const model = new SourceDraftModel(service.value, {
      sessionId: SESSION_ID,
      baseSha: BASE_SHA,
      files: [{ path: 'index.ts', content: 'one' }],
    })

    const firstSave = model.save()
    await vi.waitFor(() => { expect(service.save).toHaveBeenCalledTimes(1) })
    model.setFiles([{ path: 'index.ts', content: 'two' }])
    release(saveResult(draft(1, 'one')))
    await firstSave

    expect(model.getSnapshot()).toMatchObject({ status: 'dirty', dirty: true, files: [{ content: 'two' }] })
    const secondSave = model.save()
    await secondSave
    expect(service.save).toHaveBeenLastCalledWith({
      draftId: 'draft-source-model',
      expectedRevision: 1,
      sessionId: SESSION_ID,
      baseSha: BASE_SHA,
      files: [{ path: 'index.ts', content: 'two' }],
    })
    expect(model.getSnapshot()).toMatchObject({ status: 'saved', dirty: false, draft: { revision: 2 } })

    service.publish.mockResolvedValueOnce({
      ok: true,
      value: { ok: true, value: { branch: 'draft/source-model', commit: 'c'.repeat(40) } },
    })
    await expect(model.publish()).resolves.toMatchObject({ ok: true, value: { ok: true } })
    expect(service.publish).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      draftId: 'draft-source-model',
      expectedRevision: 2,
    }, undefined)
    expect(model.getSnapshot().status).toBe('published')
  })

  it('does not publish dirty files and exposes Host revision conflicts', async () => {
    const service = remote()
    const model = new SourceDraftModel(service.value, {
      sessionId: SESSION_ID,
      baseSha: BASE_SHA,
      files: [{ path: 'index.ts', content: 'one' }],
    })

    const beforeSave = await model.publish()
    expect(beforeSave).toMatchObject({ ok: false, error: { code: 'source-draft-not-ready' } })
    expect(service.publish).not.toHaveBeenCalled()

    const current = draft(3, 'server')
    service.save.mockResolvedValueOnce({
      ok: true,
      value: {
        ok: false,
        error: { code: 'version-conflict', current },
      },
    })
    const conflict = await model.save()
    expect(conflict).toMatchObject({ ok: true, value: { ok: false, error: { code: 'version-conflict' } } })
    expect(model.getSnapshot()).toMatchObject({ status: 'conflict', dirty: true, error: { code: 'version-conflict' } })
  })

  it('keeps local dirty files after deleting the saved draft', async () => {
    const service = remote()
    service.save.mockResolvedValueOnce(saveResult(draft(1, 'saved')))
    service.value.delete = vi.fn().mockResolvedValue({
      ok: true,
      value: { ok: true, value: { deleted: true } },
    })
    const model = new SourceDraftModel(service.value, {
      sessionId: SESSION_ID,
      baseSha: BASE_SHA,
      files: [{ path: 'index.ts', content: 'saved' }],
    })

    await model.save()
    model.setFiles([{ path: 'index.ts', content: 'local edit' }])
    await expect(model.delete()).resolves.toMatchObject({ ok: true, value: { ok: true } })

    expect(model.getSnapshot()).toMatchObject({
      draft: null,
      status: 'dirty',
      dirty: true,
      files: [{ path: 'index.ts', content: 'local edit' }],
    })
  })
})
