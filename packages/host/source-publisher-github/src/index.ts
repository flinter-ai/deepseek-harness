/** Host-only Git worktree -> GitHub Pull Request source publisher. */

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, lstat, rm } from 'node:fs/promises'
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type {
  SourcePublisher,
  SourcePublisherInput,
} from '@deepseek-ai/dsh-api-source-controller'
import type { SourceDraftPublishValue, SourceFile } from '@deepseek-ai/dsh-api-source-controller/types'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  addGitWorktree,
  ensureWorktreeRoot,
  removeGitWorktree,
  resolveGitCommit,
  resolveGitRepository,
} from '@deepseek-ai/dsh-workspace/src/git-worktree'

const execFileAsync = promisify(execFile)
const GIT_OUTPUT_LIMIT = 1024 * 1024
const DEFAULT_BASE_BRANCH = 'master'
const DEFAULT_REMOTE = 'origin'
const DEFAULT_BRANCH_PREFIX = 'dsh/source'
const DEFAULT_TOKEN_ENV = 'GITHUB_TOKEN'

/** GitHub PR creation request, kept provider-neutral for deterministic tests. */
export interface PullRequestRequest {
  readonly owner: string
  readonly repo: string
  readonly head: string
  readonly base: string
  readonly title: string
  readonly body: string
  readonly token: string
  readonly signal: AbortSignal
}

/** Minimal PR client used by the publisher after the Git push succeeds. */
export interface PullRequestClient {
  create(request: PullRequestRequest): Promise<string>
}

/** Configuration for one deployment-owned GitHub publisher. */
export interface GitHubSourcePublisherConfig {
  /** Fixed repository allow-list; when omitted, the Session cwd selects it. */
  readonly repositoryRoot?: string
  /** Dedicated directory for temporary publication worktrees. */
  readonly worktreeRoot?: string
  readonly owner: string
  readonly repo: string
  readonly baseBranch?: string
  readonly remote?: string
  readonly branchPrefix?: string
  /** Resolves a token at publish time; raw tokens never cross the browser seam. */
  readonly token: () => Promise<string | undefined>
  readonly pullRequestClient?: PullRequestClient
  readonly commitAuthor?: { readonly name: string; readonly email: string }
}

/** Optional Web composition row. Missing repository identity leaves publishing unavailable. */
export interface Config {
  readonly enabled?: boolean
  readonly repositoryRoot?: string
  readonly worktreeRoot?: string
  readonly owner?: string
  readonly repo?: string
  readonly baseBranch?: string
  readonly remote?: string
  readonly branchPrefix?: string
  readonly tokenEnv?: string
}

/** Safe operation error; underlying Git/HTTP output is intentionally not exposed to the browser. */
export class SourcePublisherError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SourcePublisherError'
  }
}

/** GitHub REST implementation; it never logs or echoes the bearer token. */
export class GitHubPullRequestClient implements PullRequestClient {
  constructor(private readonly request: typeof fetch = fetch) {}

  async create(input: PullRequestRequest): Promise<string> {
    const response = await this.request(
      `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls`,
      {
        method: 'POST',
        signal: input.signal,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${input.token}`,
          'content-type': 'application/json',
          'x-github-api-version': '2022-11-28',
        },
        body: JSON.stringify({
          title: input.title,
          head: input.head,
          base: input.base,
          body: input.body,
        }),
      },
    )
    if (!response.ok) throw new SourcePublisherError(`GitHub Pull Request creation failed (${response.status})`)
    const value = await response.json() as { readonly html_url?: unknown }
    if (typeof value.html_url !== 'string' || value.html_url.length === 0) {
      throw new SourcePublisherError('GitHub returned no Pull Request URL')
    }
    return value.html_url
  }
}

/**
 * Publishes an exact saved draft from a clean, temporary worktree. The source
 * repository is selected from Session cwd and optionally checked against the
 * deployment allow-list; the browser never chooses a repository or branch.
 */
export class GitHubSourcePublisher implements SourcePublisher {
  private readonly repositoryRoot: string | undefined
  private readonly worktreeRoot: string
  private readonly baseBranch: string
  private readonly remote: string
  private readonly branchPrefix: string
  private readonly pullRequestClient: PullRequestClient
  private readonly commitAuthor: { readonly name: string; readonly email: string }

  constructor(private readonly config: GitHubSourcePublisherConfig) {
    this.repositoryRoot = config.repositoryRoot === undefined ? undefined : resolve(config.repositoryRoot)
    this.worktreeRoot = resolve(config.worktreeRoot ?? join(resolveDshHome(), 'source-publish-worktrees'))
    this.baseBranch = config.baseBranch ?? DEFAULT_BASE_BRANCH
    this.remote = config.remote ?? DEFAULT_REMOTE
    this.branchPrefix = config.branchPrefix ?? DEFAULT_BRANCH_PREFIX
    this.pullRequestClient = config.pullRequestClient ?? new GitHubPullRequestClient()
    this.commitAuthor = config.commitAuthor ?? {
      name: 'DSH Source Publisher',
      email: 'dsh-source-publisher@localhost',
    }
  }

  async publish(input: SourcePublisherInput): Promise<SourceDraftPublishValue> {
    if (input.signal.aborted) throw input.signal.reason ?? new SourcePublisherError('publication aborted')
    const token = await this.config.token()
    if (input.signal.aborted) throw input.signal.reason ?? new SourcePublisherError('publication aborted')
    if (token === undefined || token.trim() === '') {
      throw new SourcePublisherError('GitHub publisher token is not configured')
    }

    const repositoryRoot = await this.resolveRepository(input)
    const baseSha = await resolveGitCommit(repositoryRoot, input.draft.baseSha)
    if (baseSha.toLowerCase() !== input.draft.baseSha.toLowerCase()) {
      throw new SourcePublisherError('source draft base revision is not an exact commit')
    }
    await ensureWorktreeRoot(this.worktreeRoot)

    const branch = `${this.branchPrefix}/${safeSegment(String(input.session.id))}-${safeSegment(String(input.draft.draftId))}-${randomUUID().slice(0, 8)}`
    const worktreePath = join(this.worktreeRoot, `.publish-${randomUUID()}`)
    let worktreeCreated = false
    try {
      await addGitWorktree({ repositoryRoot, worktreePath, branch, commit: baseSha })
      worktreeCreated = true
      await writeFiles(worktreePath, input.draft.files)
      await git(worktreePath, ['diff', '--check'], 'source diff check')
      await git(worktreePath, ['add', '--', ...input.draft.files.map(file => file.path)], 'stage source files')
      await git(worktreePath, ['diff', '--cached', '--check'], 'staged source diff check')
      const staged = await gitAllowEmpty(worktreePath, ['diff', '--cached', '--quiet'], 'inspect staged source')
      if (staged === 0) throw new SourcePublisherError('source draft has no changes against its base')
      await git(worktreePath, [
        '-c', `user.name=${this.commitAuthor.name}`,
        '-c', `user.email=${this.commitAuthor.email}`,
        'commit', '-m', `chore(source): publish draft ${String(input.draft.draftId)}`,
      ], 'commit source draft')
      const commit = await git(worktreePath, ['rev-parse', 'HEAD'], 'resolve source commit')
      await git(worktreePath, ['push', this.remote, `HEAD:refs/heads/${branch}`], 'push source branch')
      const pullRequestUrl = await this.pullRequestClient.create({
        owner: this.config.owner,
        repo: this.config.repo,
        head: branch,
        base: this.baseBranch,
        title: `Publish source draft ${String(input.draft.draftId)}`,
        body: [
          'Created by DSH SourceDraftModel.',
          '',
          `- Session: \`${String(input.draft.sessionId)}\``,
          `- Draft revision: \`${String(input.draft.revision)}\``,
          `- Base: \`${input.draft.baseSha}\``,
        ].join('\n'),
        token,
        signal: input.signal,
      })
      return Object.freeze({ branch, commit, pullRequestUrl })
    } finally {
      if (worktreeCreated) await cleanupWorktree(repositoryRoot, worktreePath, branch)
    }
  }

  private async resolveRepository(input: SourcePublisherInput): Promise<string> {
    const selected = input.session.cwd ?? this.repositoryRoot
    if (selected === undefined) throw new SourcePublisherError('source Session has no Git project cwd')
    const repositoryRoot = await resolveGitRepository(selected)
    if (this.repositoryRoot !== undefined) {
      const allowedRoot = await resolveGitRepository(this.repositoryRoot)
      if (repositoryRoot !== allowedRoot) {
        throw new SourcePublisherError('source Session project is outside the publisher repository allow-list')
      }
    }
    return repositoryRoot
  }
}

/** Compose the publisher only when deployment identity is complete. */
export function apply(ctx: Context, config: Config = {}): void {
  if (config.enabled === false || config.owner === undefined || config.repo === undefined) return
  const tokenEnv = config.tokenEnv ?? DEFAULT_TOKEN_ENV
  const publisher = new GitHubSourcePublisher({
    owner: config.owner,
    repo: config.repo,
    ...(config.repositoryRoot === undefined ? {} : { repositoryRoot: config.repositoryRoot }),
    ...(config.worktreeRoot === undefined ? {} : { worktreeRoot: config.worktreeRoot }),
    ...(config.baseBranch === undefined ? {} : { baseBranch: config.baseBranch }),
    ...(config.remote === undefined ? {} : { remote: config.remote }),
    ...(config.branchPrefix === undefined ? {} : { branchPrefix: config.branchPrefix }),
    token: async () => process.env[tokenEnv],
  })
  ctx.provide('sourcePublisher', publisher)
}

async function writeFiles(worktreePath: string, files: readonly SourceFile[]): Promise<void> {
  for (const file of files) {
    const target = safeTarget(worktreePath, file.path)
    await assertNoSymlinkParents(worktreePath, target)
    await mkdir(resolve(target, '..'), { recursive: true })
    await writeFile(target, file.content, { encoding: 'utf8', flag: 'w' })
  }
}

function safeTarget(root: string, filePath: string): string {
  if (filePath.length === 0 || filePath.includes('\\') || filePath.includes('\0') || isAbsolute(filePath)) {
    throw new SourcePublisherError(`unsafe source path: ${filePath}`)
  }
  if (normalize(filePath) !== filePath || filePath.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new SourcePublisherError(`unsafe source path: ${filePath}`)
  }
  const target = resolve(root, filePath)
  const boundary = `${resolve(root)}${sep}`
  if (target !== resolve(root) && !target.startsWith(boundary)) {
    throw new SourcePublisherError(`source path escapes the publication worktree: ${filePath}`)
  }
  return target
}

async function assertNoSymlinkParents(root: string, target: string): Promise<void> {
  const rel = relative(root, target)
  const parts = rel.split(sep)
  let current = root
  for (const [index, part] of parts.entries()) {
    current = join(current, part)
    try {
      const stats = await lstat(current)
      if (stats.isSymbolicLink()) throw new SourcePublisherError(`source path traverses a symlink: ${rel}`)
      if (index < parts.length - 1 && !stats.isDirectory()) {
        throw new SourcePublisherError(`source path parent is not a directory: ${rel}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }
}

async function cleanupWorktree(repositoryRoot: string, worktreePath: string, branch: string): Promise<void> {
  try {
    await removeGitWorktree(worktreePath)
  } catch {
    await git(repositoryRoot, ['worktree', 'remove', '--force', worktreePath], 'clean up source worktree')
  }
  await git(repositoryRoot, ['branch', '-D', branch], 'clean up source branch')
  await rm(worktreePath, { recursive: true, force: true })
}

async function git(cwd: string, args: readonly string[], phase: string): Promise<string> {
  try {
    const result = await execFileAsync('git', [...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: GIT_OUTPUT_LIMIT,
      shell: false,
      windowsHide: true,
    })
    return result.stdout.trim()
  } catch (error) {
    throw new SourcePublisherError(`${phase} failed`, { cause: error })
  }
}

async function gitAllowEmpty(cwd: string, args: readonly string[], phase: string): Promise<number> {
  try {
    await execFileAsync('git', [...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: GIT_OUTPUT_LIMIT,
      shell: false,
      windowsHide: true,
    })
    return 0
  } catch (error) {
    const code = (error as { readonly code?: string | number }).code
    if (code === 1 || code === '1') return 1
    throw new SourcePublisherError(`${phase} failed`, { cause: error })
  }
}

function safeSegment(value: string): string {
  const candidate = value.slice(0, 96)
  let segment = ''
  for (let index = 0; index < candidate.length && segment.length < 48; index += 1) {
    const code = candidate.charCodeAt(index)
    const allowed = (code >= 48 && code <= 57)
      || (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122)
      || code === 45 || code === 46 || code === 95
    segment += allowed ? candidate[index] : '-'
  }
  let end = segment.length
  while (end > 0 && segment.charCodeAt(end - 1) === 45) end -= 1
  let start = 0
  while (start < end && segment.charCodeAt(start) === 45) start += 1
  const trimmed = segment.slice(start, end)
  return trimmed.length === 0 ? 'source' : trimmed
}

export type { SourcePublisher, SourcePublisherInput }
