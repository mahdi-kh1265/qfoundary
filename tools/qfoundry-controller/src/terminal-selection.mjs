import path from 'node:path'

export function allTerminals(raw) {
  return (
    [raw, raw?.terminals, raw?.items, raw?.result?.terminals, raw?.result?.items].find(
      (candidate) => Array.isArray(candidate)
    ) ?? []
  )
}

export function taskWorktreePath(task) {
  return task.worker?.worktreePath ?? task.worktree?.path ?? task.worktreePath
}

function terminalMatchesTask(terminal, task) {
  const terminalPath = terminal.cwd ?? terminal.path ?? terminal.worktreePath
  const expectedPath = taskWorktreePath(task)
  if (!expectedPath || !terminalPath) {
    return false
  }
  return path.resolve(terminalPath).toLowerCase() === path.resolve(expectedPath).toLowerCase()
}

function terminalAgentScore(terminal, task) {
  const title = String(terminal.title ?? '')
  const command = String(terminal.command ?? '')
  const preview = String(terminal.preview ?? terminal.lastOutput ?? '')
  const haystack = `${title}\n${command}\n${preview}`.toLowerCase()
  let score = 0
  if (terminal.handle === task.worker?.terminalHandle) {
    score += 40
  }
  if (terminal.connected !== false && terminal.writable !== false) {
    score += 10
  }
  if (/\b(codex|claude|agy|antigravity|gpt-|qfoundry)\b/.test(haystack)) {
    score += 50
  }
  if (title && !/^terminal\s+\d+$/i.test(title)) {
    score += 15
  }
  if (/use \/skills|worked for|\u203a/.test(haystack)) {
    score += 25
  }
  if (/^(ps|cmd)(\s|:)|>\s*$/i.test(preview.trim())) {
    score -= 30
  }
  return score
}

export function bestMatchingTerminal(terminals, task) {
  return terminals
    .filter((terminal) => terminalMatchesTask(terminal, task))
    .sort((left, right) => {
      const scoreDelta = terminalAgentScore(right, task) - terminalAgentScore(left, task)
      if (scoreDelta !== 0) {
        return scoreDelta
      }
      return (right.lastOutputAt ?? 0) - (left.lastOutputAt ?? 0)
    })[0]
}

export function shouldKeepCurrentTerminal(current, bestMatch, task) {
  return (
    !bestMatch ||
    bestMatch.handle === current.handle ||
    terminalAgentScore(current, task) >= terminalAgentScore(bestMatch, task)
  )
}
