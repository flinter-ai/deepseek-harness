import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'

// Linux x64 jobs must use the dedicated self-hosted selector below. These are
// the only hosted labels reserved for non-x64 platform exceptions.
export const STANDARD_GITHUB_RUNNERS = new Set([
  'ubuntu-24.04-arm',
  'windows-latest',
  'windows-2025',
  'macos-latest',
])

export const SELF_HOSTED_LINUX_RUNNER = ['self-hosted', 'linux', 'x64', 'ci-linux'] as const
export const SELF_HOSTED_LINUX_LABEL = SELF_HOSTED_LINUX_RUNNER[SELF_HOSTED_LINUX_RUNNER.length - 1]

const FORBIDDEN_RUNNER_MARKER = /\b(?:vm-backup|dsh-win-ci|dsh-(?:ubuntu|windows)|DSH_CI_FAILOVER_[A-Z_]+)\b/
const MATRIX_RUNNER = /^\$\{\{\s*matrix\.(runner|os)\s*\}\}$/
const GENERATED_MATRIX = /fromJSON\(needs\.(plan|matrix)\.outputs\.(matrix|ci|prebuilds)\)/i

type RunnerSelector = string | string[]

export type RunnerPolicyViolation = {
  file: string
  message: string
}

export function validateWorkflowSource(
  file: string,
  source: string,
  repositoryRoot: string,
): RunnerPolicyViolation[] {
  const violations: RunnerPolicyViolation[] = []
  if (FORBIDDEN_RUNNER_MARKER.test(source)) {
    violations.push({ file, message: 'contains a forbidden legacy private-runner marker' })
  }

  let workflow: unknown
  try {
    workflow = yaml.load(source)
  } catch (error) {
    violations.push({ file, message: `cannot parse YAML: ${error instanceof Error ? error.message : String(error)}` })
    return violations
  }
  if (!isRecord(workflow) || !isRecord(workflow.jobs)) {
    return violations
  }

  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (!isRecord(job) || job['runs-on'] === undefined) continue
    const selector = job['runs-on']
    if (typeof selector === 'string') {
      const matrixMatch = selector.match(MATRIX_RUNNER)
      if (matrixMatch) {
        const dimension = matrixMatch[1]
        if (!dimension) {
          violations.push({ file, message: `${jobName}: ${selector} has no matrix dimension` })
          continue
        }
        const values = resolveMatrixValues(job, dimension, source, repositoryRoot)
        if (values.length === 0) {
          violations.push({ file, message: `${jobName}: dynamic ${selector} has no statically verifiable standard values` })
        } else {
          for (const value of values) validateSelector(violations, file, `${jobName}: ${selector}`, value)
        }
      } else {
        validateSelector(violations, file, `${jobName}: runs-on`, selector)
      }
    } else if (Array.isArray(selector) && selector.every(value => typeof value === 'string')) {
      validateSelector(violations, file, `${jobName}: runs-on`, selector)
    } else {
      violations.push({ file, message: `${jobName}: runs-on must be an approved hosted label or the exact self-hosted Linux selector` })
    }
  }

  return violations
}

export function validateRepository(repositoryRoot: string): RunnerPolicyViolation[] {
  const workflowDirectory = resolve(repositoryRoot, '.github/workflows')
  const violations: RunnerPolicyViolation[] = []
  for (const fileName of readdirSync(workflowDirectory).filter(file => /\.ya?ml$/.test(file))) {
    const file = `.github/workflows/${fileName}`
    violations.push(...validateWorkflowSource(file, readFileSync(resolve(repositoryRoot, file), 'utf8'), repositoryRoot))
  }
  return violations
}

function resolveMatrixValues(
  job: Record<string, unknown>,
  dimension: string,
  workflowSource: string,
  repositoryRoot: string,
): RunnerSelector[] {
  const strategy = job.strategy
  if (isRecord(strategy) && isRecord(strategy.matrix) && Array.isArray(strategy.matrix.include)) {
    return strategy.matrix.include
      .filter(isRecord)
      .map(row => row[dimension])
      .filter(isRunnerSelector)
  }

  const matrixExpression = isRecord(strategy)
    ? typeof strategy.matrix === 'string'
      ? strategy.matrix
      : isRecord(strategy.matrix) && typeof strategy.matrix.include === 'string'
        ? strategy.matrix.include
        : ''
    : ''
  if (!GENERATED_MATRIX.test(matrixExpression)) return []

  // The SDK matrix is assembled in the workflow's shell case statement. Every
  // runner assignment must be a literal from the standard allowlist.
  if (/needs\.plan\.outputs\.matrix/i.test(matrixExpression)) {
    const workflowAssignments = [...workflowSource.matchAll(/\brunner=(?:(['\"])(.*?)\1|([A-Za-z0-9_.-]+))/g)]
      .map(match => match[2] ?? match[3])
      .map((value) => {
        if (value === undefined) return undefined
        if (!value.startsWith('[')) return value
        try {
          const parsed: unknown = JSON.parse(value)
          return isRunnerSelector(parsed) ? parsed : undefined
        } catch {
          return undefined
        }
      })
      .filter(isRunnerSelector)
    if (workflowAssignments.length > 0) return workflowAssignments
    return []
  }

  // The native Landlock matrices are emitted by this checked-in generator.
  // Read its literal RUNNERS map rather than trusting a generated output.
  if (!/needs\.matrix\.outputs\.(?:ci|prebuilds)/i.test(matrixExpression)) return []
  const generator = resolve(repositoryRoot, 'native/landlock-run/scripts/github-matrix.mjs')
  try {
    const generatorSource = readFileSync(generator, 'utf8')
    return [...generatorSource.matchAll(/'[^']+'\s*:\s*'([^']+)'/g)]
      .map(match => match[1])
      .filter(isRunnerSelector)
  } catch {
    return []
  }
}

function validateSelector(
  violations: RunnerPolicyViolation[],
  file: string,
  location: string,
  selector: RunnerSelector,
): void {
  if (typeof selector === 'string') {
    if (STANDARD_GITHUB_RUNNERS.has(selector) || selector === SELF_HOSTED_LINUX_LABEL) return
    violations.push({ file, message: `${location} selects '${selector}', which is not an approved hosted label or self-hosted label` })
    return
  }

  if (selector.length === SELF_HOSTED_LINUX_RUNNER.length
    && selector.every((label, index) => label === SELF_HOSTED_LINUX_RUNNER[index])) {
    return
  }
  violations.push({ file, message: `${location} must use the exact self-hosted Linux selector [${SELF_HOSTED_LINUX_RUNNER.join(', ')}] when selecting a runner array` })
}

function isRunnerSelector(value: unknown): value is RunnerSelector {
  return typeof value === 'string'
    || (Array.isArray(value) && value.every(item => typeof item === 'string'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

if (process.argv[1]?.endsWith('verify-ci-runner-policy.ts')) {
  const repositoryRoot = resolve(import.meta.dirname, '..')
  const violations = validateRepository(repositoryRoot)
  if (violations.length > 0) {
    for (const violation of violations) console.error(`::error file=${violation.file}::${violation.message}`)
    process.exitCode = 1
  } else {
    console.log(`verify-ci-runner-policy: ${readdirSync(resolve(repositoryRoot, '.github/workflows')).filter(file => /\.ya?ml$/.test(file)).length} workflow file(s) use approved hosted or self-hosted runner selectors`)
  }
}
