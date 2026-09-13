/**
 * Narrow Git worktree adapter used by the workspace registry.
 *
 * Every Git invocation is an argv-based `execFile` call. The adapter never
 * interpolates repository paths, branch names, or revisions into a shell
 * command string.
 * @module @deepseek-ai/dsh-workspace/src/git-worktree
 */

import { execFile } from 'node:child_process'
import { lstat, mkdir, realpath, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const GIT_OUTPUT_LIMIT = 1024 * 1024

/** Git metadata observed for one existing worktree. */
export interface GitWorktreeSnapshot {
  /** Canonical worktree directory. */
  readonly worktreePath: string

  /** Canonical source repository root. */
  readonly repositoryRoot: string

  /** Currently checked-out branch. */
  readonly branch: string

  /** Current `HEAD` commit. */
  readonly commit: string
}

/** Error raised when a Git worktree operation cannot be completed safely. */
export class GitWorktreeError extends Error {
  /**
   * @param message - Safe operation-level diagnostic.
   * @param options - Optional underlying failure.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'GitWorktreeError'
  }
}

/**
 * Resolve an existing directory to the canonical root of its Git repository.
 *
 * @param path - Existing repository or worktree directory.
 * @returns the canonical repository root.
 */
export async function resolveGitRepository(path: string): Promise<string> {
  const cwd = await existingDirectory(path, 'Git repository')
  return await repositoryRootFrom(cwd)
}

/**
 * Resolve a Git revision to its full object id.
 *
 * @param repositoryRoot - Canonical repository root.
 * @param revision - Revision expression, defaulting to `HEAD`.
 * @returns the resolved commit id.
 */
export async function resolveGitCommit(repositoryRoot: string, revision?: string): Promise<string> {
  const selected = revision?.trim() || 'HEAD'
  if (selected.startsWith('-') || selected.includes('\0')) {
    throw new GitWorktreeError('Git base revision must be a non-option argument')
  }
  const commit = await git(repositoryRoot, ['rev-parse', '--verify', `${selected}^{commit}`])
  if (!/^[0-9a-f]{40,64}$/i.test(commit)) {
    throw new GitWorktreeError(`Git revision '${selected}' did not resolve to a commit id`)
  }
  return commit
}

/**
 * Add one new branch-backed worktree and inspect the result.
 *
 * @param options - Repository, destination, branch, and resolved base commit.
 * @returns the observed worktree metadata.
 */
export async function addGitWorktree(options: {
  readonly repositoryRoot: string
  readonly worktreePath: string
  readonly branch: string
  readonly commit: string
}): Promise<GitWorktreeSnapshot> {
  await ensureAbsent(options.worktreePath)
  await assertBranch(options.repositoryRoot, options.branch)
  try {
    await git(options.repositoryRoot, [
      'worktree', 'add', '-b', options.branch, options.worktreePath, options.commit,
    ])
  } catch (error) {
    throw new GitWorktreeError(
      `failed to create Git worktree '${options.worktreePath}'`,
      { cause: error },
    )
  }
  return await inspectGitWorktree(options.worktreePath)
}

/**
 * Inspect one existing worktree without changing it.
 *
 * @param path - Existing worktree directory.
 * @returns canonical repository, branch, path, and current commit.
 */
export async function inspectGitWorktree(path: string): Promise<GitWorktreeSnapshot> {
  const worktreePath = await existingDirectory(path, 'Git worktree')
  try {
    const worktreeRoot = await existingDirectory(
      await git(worktreePath, ['rev-parse', '--show-toplevel']),
      'Git worktree root',
    )
    if (worktreeRoot !== worktreePath) {
      throw new GitWorktreeError(
        `Git path '${worktreePath}' is inside worktree '${worktreeRoot}', not its root`,
      )
    }
    const repositoryRoot = await repositoryRootFrom(worktreePath)
    const branch = await git(worktreePath, ['branch', '--show-current'])
    if (branch.length === 0) {
      throw new GitWorktreeError(`Git worktree '${worktreePath}' is detached`)
    }
    const commit = await git(worktreePath, ['rev-parse', 'HEAD'])
    if (!/^[0-9a-f]{40,64}$/i.test(commit)) {
      throw new GitWorktreeError(`Git worktree '${worktreePath}' has an invalid HEAD`)
    }
    return Object.freeze({ worktreePath, repositoryRoot, branch, commit })
  } catch (error) {
    if (error instanceof GitWorktreeError) throw error
    throw new GitWorktreeError(`'${worktreePath}' is not a usable Git worktree`, { cause: error })
  }
}

/**
 * Remove a worktree through its owning repository. Git refuses this operation
 * when the worktree is dirty, so a user-owned working tree is never forcefully
 * deleted by this adapter.
 *
 * @param path - Worktree to remove.
 */
export async function removeGitWorktree(path: string): Promise<void> {
  const snapshot = await inspectGitWorktree(path)
  try {
    await git(snapshot.repositoryRoot, ['worktree', 'remove', snapshot.worktreePath])
  } catch (error) {
    throw new GitWorktreeError(
      `failed to roll back Git worktree '${snapshot.worktreePath}'`,
      { cause: error },
    )
  }
}

async function assertBranch(repositoryRoot: string, branch: string): Promise<void> {
  if (branch.length === 0 || branch.startsWith('-') || branch.includes('\0')) {
    throw new GitWorktreeError('Git branch must be a non-option argument')
  }
  try {
    await git(repositoryRoot, ['check-ref-format', '--branch', branch])
  } catch (error) {
    throw new GitWorktreeError(`invalid Git branch '${branch}'`, { cause: error })
  }
}

async function repositoryRootFrom(cwd: string): Promise<string> {
  const commonDirectory = resolve(cwd, await git(cwd, [
    'rev-parse', '--path-format=absolute', '--git-common-dir',
  ]))
  return await existingDirectory(dirname(commonDirectory), 'Git repository root')
}

async function existingDirectory(path: string, label: string): Promise<string> {
  let canonical: string
  try {
    canonical = await realpath(path)
    if (!(await stat(canonical)).isDirectory()) {
      throw new GitWorktreeError(`${label} '${canonical}' is not a directory`)
    }
  } catch (error) {
    if (error instanceof GitWorktreeError) throw error
    throw new GitWorktreeError(`cannot resolve ${label.toLowerCase()} '${path}'`, { cause: error })
  }
  return canonical
}

async function ensureAbsent(path: string): Promise<void> {
  try {
    await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw new GitWorktreeError(`cannot inspect Git worktree destination '${path}'`, { cause: error })
  }
  throw new GitWorktreeError(`Git worktree destination '${path}' already exists`)
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
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
    const detail = error instanceof Error ? error.message : String(error)
    throw new GitWorktreeError(`git ${args.join(' ')} failed: ${detail}`, { cause: error })
  }
}

/**
 * Ensure the configured worktree root exists and return its canonical spelling.
 *
 * @param path - Directory to create when absent.
 * @returns the canonical worktree root path.
 */
export async function ensureWorktreeRoot(path: string): Promise<string> {
  try {
    await mkdir(path, { recursive: true })
  } catch (error) {
    throw new GitWorktreeError(`cannot create worktree root '${path}'`, { cause: error })
  }
  return await existingDirectory(path, 'worktree root')
}
