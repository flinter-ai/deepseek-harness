import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionId, SESSION_FORMAT_VERSION, type SessionHeader } from '@deepseek-ai/dsh-session/types'
import type { SourceDraft } from '@deepseek-ai/dsh-api-source-controller/types'
import { resolveGitCommit } from '@deepseek-ai/dsh-workspace/src/git-worktree'
import { GitHubSourcePublisher, type PullRequestRequest } from '../src/index.ts'

const execFileAsync = promisify(execFile)
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('GitHubSourcePublisher', () => {
  it('publishes an exact saved draft through an isolated worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-source-publisher-test-'))
    roots.push(root)
    const repositoryRoot = join(root, 'repo')
    const remoteRoot = join(root, 'remote.git')
    const worktreeRoot = join(root, 'worktrees')
    await mkdir(repositoryRoot, { recursive: true })
    await git(repositoryRoot, ['init', '--quiet', '--initial-branch', 'main'])
    await git(repositoryRoot, ['config', 'user.name', 'source-publisher-test'])
    await git(repositoryRoot, ['config', 'user.email', 'source-publisher-test@localhost'])
    await writeFile(join(repositoryRoot, 'README.md'), '# source publisher\n')
    await git(repositoryRoot, ['add', '--', 'README.md'])
    await git(repositoryRoot, ['commit', '--quiet', '-m', 'base'])
    await git(root, ['init', '--bare', remoteRoot])
    await git(repositoryRoot, ['remote', 'add', 'origin', remoteRoot])

    const baseSha = await resolveGitCommit(repositoryRoot, 'HEAD')
    const sessionId = SessionId('source-publisher-session')
    const session: SessionHeader = {
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: 1_700_000_000_000,
      cwd: repositoryRoot,
    }
    const draft = {
      draftId: 'source-publisher-draft' as SourceDraft['draftId'],
      sessionId,
      baseSha,
      files: [{ path: 'src/index.ts', content: 'export const answer = 42\n' }],
      revision: 1,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_001,
    } satisfies SourceDraft
    let request: PullRequestRequest | undefined
    const publisher = new GitHubSourcePublisher({
      repositoryRoot,
      worktreeRoot,
      owner: 'acme',
      repo: 'demo',
      token: async () => 'test-token',
      pullRequestClient: {
        async create(input) {
          request = input
          return 'https://github.com/acme/demo/pull/1'
        },
      },
    })

    const result = await publisher.publish({
      draft,
      session,
      signal: new AbortController().signal,
    })

    expect(result).toMatchObject({ pullRequestUrl: 'https://github.com/acme/demo/pull/1' })
    expect(result.branch).toMatch(/^dsh\/source\/source-publisher-session-source-publisher-draft-[0-9a-f]{8}$/)
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(request).toMatchObject({
      owner: 'acme',
      repo: 'demo',
      head: result.branch,
      base: 'master',
      token: 'test-token',
    })
    const refs = await git(remoteRoot, ['show-ref'])
    expect(refs).toContain(`refs/heads/${result.branch}`)
    expect(await git(repositoryRoot, ['branch', '--list', result.branch])).toBe('')
    expect(await git(repositoryRoot, ['worktree', 'list'])).not.toContain(String(result.branch))
    expect(await readFile(join(repositoryRoot, 'README.md'), 'utf8')).toBe('# source publisher\n')
  })

  it('fails closed for unsafe paths before creating a publication branch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-source-publisher-test-'))
    roots.push(root)
    const repositoryRoot = join(root, 'repo')
    await mkdir(repositoryRoot, { recursive: true })
    await git(repositoryRoot, ['init', '--quiet', '--initial-branch', 'main'])
    await git(repositoryRoot, ['config', 'user.name', 'source-publisher-test'])
    await git(repositoryRoot, ['config', 'user.email', 'source-publisher-test@localhost'])
    await writeFile(join(repositoryRoot, 'README.md'), '# source publisher\n')
    await git(repositoryRoot, ['add', '--', 'README.md'])
    await git(repositoryRoot, ['commit', '--quiet', '-m', 'base'])
    const baseSha = await resolveGitCommit(repositoryRoot, 'HEAD')
    const sessionId = SessionId('unsafe-source-publisher-session')
    const draft = {
      draftId: 'unsafe-source-publisher-draft' as SourceDraft['draftId'],
      sessionId,
      baseSha,
      files: [{ path: '../outside.ts', content: 'unsafe\n' }],
      revision: 1,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_001,
    } satisfies SourceDraft
    const publisher = new GitHubSourcePublisher({
      repositoryRoot,
      owner: 'acme',
      repo: 'demo',
      token: async () => 'test-token',
      pullRequestClient: { async create() { throw new Error('must not call PR client') } },
    })

    await expect(publisher.publish({
      draft,
      session: {
        version: SESSION_FORMAT_VERSION,
        id: sessionId,
        createdAt: 1_700_000_000_000,
        cwd: repositoryRoot,
      },
      signal: new AbortController().signal,
    })).rejects.toThrow('unsafe source path')
    expect(await git(repositoryRoot, ['branch', '--list', 'dsh/source'])).toBe('')
  })
})

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync('git', [...args], {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  })
  return result.stdout.trim()
}
