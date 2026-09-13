import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  DraftConflictError,
  DraftNotSavedError,
  DraftProtocol,
  SourceDraftModel,
  draftId,
  type DraftFiles,
  type DraftPublisher,
  type DraftSnapshot,
  type DraftStore,
} from '../src/index.ts'

const ID = draftId('draft-1')
const BASE: DraftSnapshot = {
  id: ID,
  workspaceId: 'workspace-1',
  revision: 'r1',
  files: { 'src/main.ts': 'export const value = 1' },
  updatedAt: 1,
}

function storeFixture(initial: DraftSnapshot = BASE): {
  store: DraftStore
  current: () => DraftSnapshot | undefined
  save: ReturnType<typeof vi.fn>
  publish: ReturnType<typeof vi.fn>
} {
  let current: DraftSnapshot | undefined = initial
  const save = vi.fn(async (request: Parameters<DraftStore['save']>[0]) => {
    current = {
      ...current ?? BASE,
      id: request.id,
      workspaceId: request.workspaceId,
      revision: request.baseRevision === undefined ? 'r1' : request.baseRevision + '-next',
      files: request.files,
      updatedAt: (current?.updatedAt ?? 0) + 1,
    }
    return current
  })
  const publish = vi.fn(async (request: Parameters<DraftPublisher['publish']>[0]) => ({
    draftId: request.id,
    revision: request.revision,
    branch: request.target.branch,
    artifactId: 'artifact-1',
  }))
  return {
    store: {
      load: vi.fn(async () => current),
      save,
      delete: vi.fn(async () => { current = undefined }),
    },
    current: () => current,
    save,
    publish,
  }
}

describe('SourceDraftModel', () => {
  it('serializes saves and keeps edits made during an earlier save dirty', async () => {
    const firstStarted = Promise.withResolvers<undefined>()
    const firstRelease = Promise.withResolvers<undefined>()
    const saves: Array<DraftFiles> = []
    const transport = {
      load: vi.fn(async () => BASE),
      save: vi.fn(async (request: Parameters<DraftStore['save']>[0]) => {
        saves.push(request.files)
        if (saves.length === 1) {
          firstStarted.resolve(undefined)
          await firstRelease.promise
        }
        return {
          ...BASE,
          revision: saves.length === 1 ? 'r2' : 'r3',
          files: request.files,
          updatedAt: saves.length + 1,
        }
      }),
      publish: vi.fn(),
      delete: vi.fn(async () => {}),
    }
    const model = new SourceDraftModel(transport)
    await model.load(ID, BASE.workspaceId)
    model.setFiles({ 'src/main.ts': 'one' })
    const first = model.save('m1')
    model.setFiles({ 'src/main.ts': 'two' })
    const second = model.save('m2')
    await firstStarted.promise
    firstRelease.resolve(undefined)
    await first
    await second
    expect(saves).toEqual([{ 'src/main.ts': 'one' }, { 'src/main.ts': 'two' }])
    expect(model.state).toBe('saved')
    expect(model.currentFiles).toEqual({ 'src/main.ts': 'two' })
  })

  it('marks a stale save as conflict and never publishes dirty content', async () => {
    const transport = {
      load: vi.fn(async () => BASE),
      save: vi.fn(async () => { throw new DraftConflictError('stale') }),
      publish: vi.fn(),
      delete: vi.fn(async () => {}),
    }
    const model = new SourceDraftModel(transport)
    await model.load(ID, BASE.workspaceId)
    model.setFiles({ 'src/main.ts': 'changed' })
    await expect(model.save('m1')).rejects.toBeInstanceOf(DraftConflictError)
    expect(model.state).toBe('conflict')
    await expect(model.publish('p1', { kind: 'branch', branch: 'draft/one' })).rejects.toBeInstanceOf(DraftNotSavedError)
    expect(transport.publish).not.toHaveBeenCalled()
  })

  it('publishes only a saved revision and stores the host receipt', async () => {
    const transport = {
      load: vi.fn(async () => BASE),
      save: vi.fn(async (request: Parameters<DraftStore['save']>[0]) => ({ ...BASE, revision: 'r2', files: request.files, updatedAt: 2 })),
      publish: vi.fn(async () => ({ draftId: ID, revision: 'r2', branch: 'draft/one', artifactId: 'a1' })),
      delete: vi.fn(async () => {}),
    }
    const model = new SourceDraftModel(transport)
    await model.load(ID, BASE.workspaceId)
    model.setFiles({ 'src/main.ts': 'changed' })
    await model.save('m1')
    await expect(model.publish('p1', { kind: 'pull-request', branch: 'draft/one', title: 'Draft' })).resolves.toMatchObject({ artifactId: 'a1' })
    expect(model.state).toBe('published')
    expect(model.publishReceipt?.artifactId).toBe('a1')
  })

  it('keeps local files dirty after deleting the remote draft', async () => {
    const transport = {
      load: vi.fn(async () => BASE),
      save: vi.fn(),
      publish: vi.fn(),
      delete: vi.fn(async () => {}),
    }
    const model = new SourceDraftModel(transport)
    await model.load(ID, BASE.workspaceId)
    model.setFiles({ 'src/main.ts': 'local-only' })
    await model.delete()
    expect(model.currentFiles).toEqual({ 'src/main.ts': 'local-only' })
    expect(model.state).toBe('dirty')
  })

  it('can save a new draft after the host reports that it does not exist', async () => {
    const transport = {
      load: vi.fn(async () => undefined),
      save: vi.fn(async (request: Parameters<DraftStore['save']>[0]) => ({
        ...BASE,
        id: request.id,
        files: request.files,
        revision: 'r1',
      })),
      publish: vi.fn(),
      delete: vi.fn(async () => {}),
    }
    const model = new SourceDraftModel(transport)
    await model.load(ID, BASE.workspaceId)
    model.setFiles({ 'src/main.ts': 'new' })
    await expect(model.save('m1')).resolves.toMatchObject({ revision: 'r1' })
    expect(model.state).toBe('saved')
  })
})

describe('DraftProtocol', () => {
  it('checks revisions before storage and gives the publisher only the durable snapshot', async () => {
    const fixture = storeFixture()
    const protocol = new DraftProtocol(new Context(), fixture.store, { publish: fixture.publish })
    const saved = await protocol.save({
      id: ID,
      workspaceId: BASE.workspaceId,
      baseRevision: BASE.revision,
      files: { 'src/main.ts': 'saved' },
      mutationId: 'm1',
    })
    expect(saved.revision).toBe('r1-next')
    await expect(protocol.save({
      id: ID,
      workspaceId: BASE.workspaceId,
      baseRevision: 'stale',
      files: { 'src/main.ts': 'bad' },
      mutationId: 'm2',
    })).rejects.toBeInstanceOf(DraftConflictError)
    const receipt = await protocol.publish({
      id: ID,
      workspaceId: BASE.workspaceId,
      revision: saved.revision,
      idempotencyKey: 'p1',
      target: { kind: 'branch', branch: 'draft/one' },
    })
    expect(receipt.artifactId).toBe('artifact-1')
    expect(fixture.publish).toHaveBeenCalledOnce()
    expect(fixture.save).toHaveBeenCalledOnce()
    expect(fixture.current()?.files).toEqual({ 'src/main.ts': 'saved' })
  })
})
