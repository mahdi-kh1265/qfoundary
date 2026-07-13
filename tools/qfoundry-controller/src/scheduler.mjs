import path from 'node:path'

const DEFAULT_MAX_CONCURRENT_WORKERS = 2
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 60_000

function toPositiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

export function maxConcurrentWorkers(state) {
  return toPositiveInteger(
    state.settings?.effectiveMaxConcurrentWorkers,
    toPositiveInteger(state.settings?.maxConcurrentWorkers, DEFAULT_MAX_CONCURRENT_WORKERS)
  )
}

export function rateLimitBackoffMs(state) {
  return toPositiveInteger(state.settings?.rateLimitBackoffMs, DEFAULT_RATE_LIMIT_BACKOFF_MS)
}

function taskRepositoryKey(task) {
  return (
    task.repositoryId ??
    task.repository?.id ??
    task.repository?.path ??
    task.worktree?.repositoryRoot ??
    task.dispatchBaseline?.repositoryRoot ??
    task.attempts?.at(-1)?.repositoryRoot ??
    task.worktree?.path ??
    task.worker?.worktreePath ??
    'unknown'
  )
}

function normalizedWorktreePath(task) {
  const value = task.worktree?.path ?? task.worker?.worktreePath ?? task.worktreePath
  return value ? path.resolve(value).toLowerCase() : null
}

function ownershipPatterns(task) {
  const values = [
    ...(task.ownedFiles ?? []),
    ...(task.ownership?.files ?? []),
    ...(task.ownership?.subsystems ?? []),
    ...(task.permittedScope ?? [])
  ]
  return values.filter(Boolean).map((item) => String(item).replaceAll('\\', '/').toLowerCase())
}

function overlaps(left, right) {
  if (left === right || left === '.' || right === '.') {
    return true
  }
  return left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

export function taskPlanCollision(candidate, activeTask) {
  if (taskRepositoryKey(candidate) !== taskRepositoryKey(activeTask)) {
    return null
  }
  const candidateHandle = candidate.worker?.terminalHandle
  const activeHandle = activeTask.worker?.terminalHandle
  if (candidateHandle && activeHandle && candidateHandle === activeHandle) {
    return `worker handle ${candidateHandle} is already assigned`
  }
  const candidateWorktree = normalizedWorktreePath(candidate)
  const activeWorktree = normalizedWorktreePath(activeTask)
  if (
    candidateWorktree &&
    activeWorktree &&
    candidateWorktree === activeWorktree &&
    candidate.worker?.create !== true
  ) {
    return 'concurrent work in the same repository must use a separate worktree'
  }
  const candidatePatterns = ownershipPatterns(candidate)
  const activePatterns = ownershipPatterns(activeTask)
  for (const candidatePattern of candidatePatterns) {
    for (const activePattern of activePatterns) {
      if (overlaps(candidatePattern, activePattern)) {
        return `ownership overlap: ${candidatePattern} conflicts with ${activePattern}`
      }
    }
  }
  return null
}

export function activeDispatchedTasks(state) {
  return (state.tasks ?? []).filter((task) => task.status === 'dispatched')
}

export function readyDispatchCandidate(state, now = new Date()) {
  const activeTasks = activeDispatchedTasks(state)
  const activeLimit = maxConcurrentWorkers(state)
  if (activeTasks.length >= activeLimit) {
    return null
  }
  for (const task of state.tasks ?? []) {
    if (task.status !== 'ready') {
      continue
    }
    const missingDependencies = (task.dependsOn ?? []).filter((dependencyId) => {
      const dependency = (state.tasks ?? []).find((candidate) => candidate.id === dependencyId)
      return !dependency || !['accepted', 'accepted_with_follow_up'].includes(dependency.status)
    })
    if (missingDependencies.length > 0) {
      task.schedulingBlocked = {
        at: now.toISOString(),
        reason: 'dependencies are not yet accepted',
        dependencies: missingDependencies
      }
      continue
    }
    if (task.dispatchId) {
      task.schedulingBlocked = {
        at: now.toISOString(),
        reason: 'ready task already has a dispatch id; refusing duplicate dispatch',
        dispatchId: task.dispatchId
      }
      continue
    }
    const backoffUntil = task.rateLimitBackoffUntil ? Date.parse(task.rateLimitBackoffUntil) : 0
    if (backoffUntil > now.getTime()) {
      task.schedulingBlocked = {
        at: now.toISOString(),
        reason: 'rate limit backoff active',
        retryAfter: task.rateLimitBackoffUntil
      }
      continue
    }
    const collision = activeTasks
      .map((activeTask) => taskPlanCollision(task, activeTask))
      .find(Boolean)
    if (collision) {
      task.schedulingBlocked = {
        at: now.toISOString(),
        reason: collision
      }
      continue
    }
    delete task.schedulingBlocked
    return task
  }
  return null
}

export function applyRateLimitBackoff(state, task, now = new Date()) {
  const activeCount = activeDispatchedTasks(state).length
  state.settings ??= {}
  state.settings.effectiveMaxConcurrentWorkers = Math.max(
    1,
    Math.min(maxConcurrentWorkers(state), activeCount - 1 || 1)
  )
  task.rateLimitBackoffUntil = new Date(now.getTime() + rateLimitBackoffMs(state)).toISOString()
  return {
    effectiveMaxConcurrentWorkers: state.settings.effectiveMaxConcurrentWorkers,
    rateLimitBackoffUntil: task.rateLimitBackoffUntil
  }
}

export function isRateLimitMessage(message, messagePayload) {
  const payload = messagePayload(message)
  const haystack = JSON.stringify({
    subject: message.subject,
    body: message.body,
    payload
  }).toLowerCase()
  return /rate.?limit|throttl|too many requests|capacity|quota/.test(haystack)
}
