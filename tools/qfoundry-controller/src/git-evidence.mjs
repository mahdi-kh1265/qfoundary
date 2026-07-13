import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'

import { isInsidePath, resolveInside } from './path-policy.mjs'
import { runProcess } from './process-runner.mjs'

const DEFAULT_GIT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_DIFF_BYTES = 200_000
const DEFAULT_MAX_GIT_OUTPUT_BYTES = 128_000

async function runGit(repoRoot, args, options = {}) {
  const result = await runProcess({
    command: 'git',
    args,
    cwd: repoRoot,
    timeoutMs: options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
    maxStdoutBytes: options.maxStdoutBytes ?? DEFAULT_MAX_GIT_OUTPUT_BYTES,
    maxStderrBytes: options.maxStderrBytes ?? DEFAULT_MAX_GIT_OUTPUT_BYTES
  })
  if (result.exitCode !== 0 || result.timedOut) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.timedOut ? 'timed out' : `exit ${result.exitCode}`}\n${result.stderr || result.stdout}`
    )
  }
  return result
}

function lines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function parsePorcelainChangedFiles(statusText) {
  const files = new Set()
  for (const line of statusText.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) {
      continue
    }
    if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
      const parts = line.split(' ')
      const filePath = parts.at(-1)
      if (filePath) {
        files.add(filePath)
      }
      continue
    }
    if (line.startsWith('? ')) {
      files.add(line.slice(2).trim())
    }
  }
  return [...files]
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

async function artifactRecord(repoRoot, relativePath) {
  const absolutePath = resolveInside(repoRoot, relativePath, 'artifact path')
  const fileStat = await stat(absolutePath)
  if (!fileStat.isFile()) {
    return {
      path: relativePath,
      type: fileStat.isDirectory() ? 'directory' : 'non-file',
      embedded: false
    }
  }
  return {
    path: relativePath,
    type: 'file',
    sizeBytes: fileStat.size,
    sha256: await sha256File(absolutePath),
    embedded: false
  }
}

export async function captureDispatchBaseline({
  worktreePath,
  timeoutMs = DEFAULT_GIT_TIMEOUT_MS
}) {
  if (!worktreePath) {
    throw new Error('worker worktree path is required before dispatch')
  }
  const repositoryRoot = (
    await runGit(worktreePath, ['rev-parse', '--show-toplevel'], { timeoutMs })
  ).stdout.trim()
  if (!repositoryRoot || !isInsidePath(repositoryRoot, worktreePath)) {
    throw new Error(`could not determine repository root for worker worktree: ${worktreePath}`)
  }
  const baseCommitSha = (
    await runGit(repositoryRoot, ['rev-parse', 'HEAD'], { timeoutMs })
  ).stdout.trim()
  const currentBranch = (
    await runGit(repositoryRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs })
  ).stdout.trim()
  if (!baseCommitSha || baseCommitSha === 'HEAD') {
    throw new Error(`could not determine base commit SHA for ${repositoryRoot}`)
  }
  return {
    workerWorktreePath: path.resolve(worktreePath),
    repositoryRoot: path.resolve(repositoryRoot),
    baseCommitSha,
    currentBranch,
    capturedAt: new Date().toISOString()
  }
}

export async function collectGitEvidence({
  task,
  timeoutMs = DEFAULT_GIT_TIMEOUT_MS,
  maxDiffBytes = DEFAULT_MAX_DIFF_BYTES
}) {
  const attempt = task.currentAttemptId
    ? task.attempts?.find((candidate) => candidate.id === task.currentAttemptId)
    : task.attempts?.at(-1)
  const baseline = attempt?.dispatchBaseline ?? task.dispatchBaseline
  if (!baseline?.repositoryRoot || !baseline?.baseCommitSha || !baseline?.workerWorktreePath) {
    throw new Error(`missing dispatch baseline for ${task.id}`)
  }
  const repoRoot = path.resolve(baseline.repositoryRoot)
  const worktreePath = path.resolve(baseline.workerWorktreePath)
  if (!isInsidePath(repoRoot, worktreePath)) {
    throw new Error(`worker worktree is outside repository root for ${task.id}`)
  }
  const currentRoot = (
    await runGit(worktreePath, ['rev-parse', '--show-toplevel'], { timeoutMs })
  ).stdout.trim()
  if (path.resolve(currentRoot) !== repoRoot) {
    throw new Error(`worker repository root changed for ${task.id}: ${currentRoot}`)
  }

  const status = await runGit(repoRoot, ['status', '--porcelain=v2', '--branch'], { timeoutMs })
  const tracked = await runGit(repoRoot, ['diff', '--name-only'], { timeoutMs })
  const staged = await runGit(repoRoot, ['diff', '--cached', '--name-only'], { timeoutMs })
  const committed = await runGit(
    repoRoot,
    ['diff', '--name-only', `${baseline.baseCommitSha}..HEAD`],
    {
      timeoutMs
    }
  )
  const untracked = await runGit(repoRoot, ['ls-files', '--others', '--exclude-standard'], {
    timeoutMs
  })
  const committedStat = await runGit(
    repoRoot,
    ['diff', '--stat', `${baseline.baseCommitSha}..HEAD`],
    {
      timeoutMs
    }
  )
  const stagedStat = await runGit(repoRoot, ['diff', '--cached', '--stat'], { timeoutMs })
  const workingStat = await runGit(repoRoot, ['diff', '--stat'], { timeoutMs })
  const committedDiff = await runGit(
    repoRoot,
    ['diff', '--no-ext-diff', `${baseline.baseCommitSha}..HEAD`, '--'],
    { timeoutMs, maxStdoutBytes: maxDiffBytes }
  )
  const stagedDiff = await runGit(repoRoot, ['diff', '--cached', '--no-ext-diff', '--'], {
    timeoutMs,
    maxStdoutBytes: maxDiffBytes
  })
  const workingDiff = await runGit(repoRoot, ['diff', '--no-ext-diff', '--'], {
    timeoutMs,
    maxStdoutBytes: maxDiffBytes
  })

  const trackedModified = lines(tracked.stdout)
  const stagedModified = lines(staged.stdout)
  const committedChanges = lines(committed.stdout)
  const untrackedFiles = lines(untracked.stdout)
  const changedFileSet = new Set([
    ...parsePorcelainChangedFiles(status.stdout),
    ...trackedModified,
    ...stagedModified,
    ...committedChanges,
    ...untrackedFiles
  ])
  const artifacts = []
  for (const filePath of untrackedFiles) {
    artifacts.push(await artifactRecord(repoRoot, filePath))
  }

  return {
    ok: true,
    taskId: task.id,
    orcaTaskId: task.orcaTaskId,
    dispatchId: task.dispatchId,
    attemptId: attempt?.id ?? null,
    baseline,
    repositoryRoot: repoRoot,
    statusPorcelainV2: status.stdout,
    trackedModified,
    stagedModified,
    committedChanges,
    untrackedFiles,
    changedFiles: [...changedFileSet].sort(),
    diffStats: {
      committed: committedStat.stdout,
      staged: stagedStat.stdout,
      workingTree: workingStat.stdout
    },
    textualDiff: {
      committed: committedDiff.stdout,
      staged: stagedDiff.stdout,
      workingTree: workingDiff.stdout,
      truncated:
        committedDiff.stdoutTruncated || stagedDiff.stdoutTruncated || workingDiff.stdoutTruncated
    },
    artifacts,
    collectedAt: new Date().toISOString()
  }
}
