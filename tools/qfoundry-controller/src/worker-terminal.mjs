import path from 'node:path'

import { extractStartupTerminal } from './orca-json-cli.mjs'
import {
  allTerminals,
  bestMatchingTerminal,
  shouldKeepCurrentTerminal
} from './terminal-selection.mjs'
import { prepareCodexWorkerProfile } from './worker-profile.mjs'

const CONTROLLER_ROOT = path.resolve(import.meta.dirname, '..')

export async function resolveWorkerTerminal({ task, state, orca, projectRoot, now }) {
  if (!task.worker?.terminalHandle && task.worker?.reuseFromTaskId) {
    const reusable = state.tasks.find((candidate) => candidate.id === task.worker.reuseFromTaskId)
    if (!reusable || !['accepted', 'accepted_with_follow_up'].includes(reusable.status)) {
      throw new Error(
        `cannot reuse worker from ${task.worker.reuseFromTaskId} before qFoundry acceptance`
      )
    }
    const reusableHandle = reusable.worker?.terminalHandle
    if (!reusableHandle) {
      throw new Error(`cannot reuse worker from ${reusable.id} without a terminal handle`)
    }
    task.worker.terminalHandle = reusableHandle
    task.worker.worktreePath = reusable.worker?.worktreePath ?? reusable.worktree?.path
    task.worker.reusedFromTaskId = reusable.id
    task.worktree ??= {}
    task.worktree.path = task.worker.worktreePath ?? task.worktree.path ?? reusable.worktree?.path
    task.worktree.orcaWorktreeId = task.worktree.orcaWorktreeId ?? reusable.worktree?.orcaWorktreeId
  }

  const terminals = allTerminals(await orca.terminalList())
  const currentHandle = task.worker?.terminalHandle
  const current = terminals.find((terminal) => terminal.handle === currentHandle)
  const bestMatch = bestMatchingTerminal(terminals, task)
  if (current && shouldKeepCurrentTerminal(current, bestMatch, task)) {
    await orca.terminalWait(current.handle)
    return current.handle
  }

  const replacement = currentHandle || task.worker?.create !== true ? bestMatch : null
  if (replacement?.handle) {
    task.worker ??= {}
    task.worker.previousTerminalHandle = currentHandle
    task.worker.terminalHandle = replacement.handle
    task.worker.reResolvedAt = now().toISOString()
    await orca.terminalWait(replacement.handle)
    return replacement.handle
  }

  if (task.worker?.create === true) {
    return await createWorkerTerminal({ task, orca, projectRoot, state, now })
  }
  throw new Error(`no concrete worker terminal handle resolved for ${task.id}`)
}

async function createWorkerTerminal({ task, orca, projectRoot, state, now }) {
  const agentId = task.worker.agentId ?? 'codex'
  if (agentId === 'qfoundry-codex-worker' || task.worker.profileName) {
    return await createProfiledCodexWorker({ task, orca, projectRoot, state, now })
  }

  const created = await orca.worktreeCreate({
    name: task.worker.worktreeName ?? task.id,
    agentId,
    repo: task.worker.repoSelector ?? task.repository?.selector ?? task.repositorySelector
  })
  const startupTerminal = extractStartupTerminal(created)
  if (!startupTerminal?.handle) {
    throw new Error(`worker creation did not return a startup terminal handle for ${task.id}`)
  }
  task.worker.terminalHandle = startupTerminal.handle
  task.worker.createdAt = now().toISOString()
  task.worker.createdWorktreeId = created.id ?? created.worktree?.id ?? created.worktreeId
  task.worktree ??= {}
  task.worktree.path = created.path ?? created.worktree?.path ?? task.worktree.path
  task.worktree.orcaWorktreeId = task.worker.createdWorktreeId
  await orca.terminalWait(startupTerminal.handle)
  return startupTerminal.handle
}

async function createProfiledCodexWorker({ task, orca, projectRoot, state, now }) {
  const created = await orca.worktreeCreate({
    name: task.worker.worktreeName ?? task.id,
    repo: task.worker.repoSelector ?? task.repository?.selector ?? task.repositorySelector
  })
  task.worker.createdAt = now().toISOString()
  task.worker.createdWorktreeId = created.id ?? created.worktree?.id ?? created.worktreeId
  task.worktree ??= {}
  task.worktree.path = created.path ?? created.worktree?.path ?? task.worktree.path
  task.worktree.orcaWorktreeId = task.worker.createdWorktreeId
  const profileEvidence = await prepareCodexWorkerProfile({
    controllerRoot: CONTROLLER_ROOT,
    projectRoot,
    state,
    task,
    worktreePath: task.worktree.path,
    now
  })
  task.worker.profileEvidence = profileEvidence
  const createdTerminal = await orca.terminalCreate({
    worktree: task.worker.createdWorktreeId ?? task.worktree.path,
    title: task.worker.terminalTitle ?? `qFoundry ${task.id}`,
    command: profileEvidence.launchCommand
  })
  const startupTerminal = extractStartupTerminal(createdTerminal) ?? createdTerminal
  if (!startupTerminal?.handle) {
    throw new Error(`custom Codex worker launch did not return a terminal handle for ${task.id}`)
  }
  task.worker.terminalHandle = startupTerminal.handle
  await orca.terminalWait(startupTerminal.handle)
  return startupTerminal.handle
}
