import path from 'node:path'

import { extractMessages, extractStartupTerminal } from './orca-json-cli.mjs'
import { readTextIfExists, resolveProjectPath, saveControllerState } from './state-store.mjs'
import {
  releaseReadyDependents,
  requireDispatchApprovalPrecondition,
  transitionTask
} from './state-machine.mjs'
import { readWorkerReport, writeReviewReport } from './reviewer.mjs'

function messageId(message) {
  return (
    message.id ?? message.messageId ?? `${message.type}:${message.taskId}:${message.dispatchId}`
  )
}

function messagePayload(message) {
  return message.payload && typeof message.payload === 'object' ? message.payload : message
}

function sameLifecycleTarget(task, message) {
  const payload = messagePayload(message)
  return payload.taskId === task.orcaTaskId && payload.dispatchId === task.dispatchId
}

function allTerminals(raw) {
  if (Array.isArray(raw)) {
    return raw
  }
  if (Array.isArray(raw.terminals)) {
    return raw.terminals
  }
  if (Array.isArray(raw.items)) {
    return raw.items
  }
  return []
}

function taskWorktreePath(task) {
  return task.worktree?.path ?? task.worker?.worktreePath ?? task.worktreePath
}

function terminalMatchesTask(terminal, task) {
  const terminalPath = terminal.cwd ?? terminal.path ?? terminal.worktreePath
  const expectedPath = taskWorktreePath(task)
  if (!expectedPath || !terminalPath) {
    return false
  }
  return path.resolve(terminalPath).toLowerCase() === path.resolve(expectedPath).toLowerCase()
}

function buildTaskSpec(state, task) {
  return JSON.stringify(
    {
      qFoundryTaskId: task.id,
      title: task.title,
      objective: task.objective,
      requirements: task.requirements ?? [],
      acceptanceCriteria: task.acceptanceCriteria ?? [],
      permittedScope: task.permittedScope ?? [],
      prohibitedActions: task.prohibitedActions ?? [],
      requiredTests: task.requiredTests ?? [],
      reportPath: task.reportPath,
      projectName: state.projectName,
      correctionOf: task.correctionOf ?? null,
      correctionInstructions: task.correctionInstructions ?? null
    },
    null,
    2
  )
}

function findTaskByOrcaIds(state, message) {
  return state.tasks.find(
    (task) => task.status === 'dispatched' && sameLifecycleTarget(task, message)
  )
}

function normalizeVerdict(verdict) {
  if (
    verdict === 'accepted' ||
    verdict === 'accepted_with_follow_up' ||
    verdict === 'rejected' ||
    verdict === 'blocked_pending_user_decision'
  ) {
    return verdict
  }
  return 'blocked_pending_user_decision'
}

export class QFoundryController {
  constructor({
    projectRoot,
    state,
    statePath,
    orca,
    reviewer,
    now = () => new Date(),
    logger = () => {}
  }) {
    this.projectRoot = path.resolve(projectRoot)
    this.state = state
    this.statePath = statePath
    this.orca = orca
    this.reviewer = reviewer
    this.now = now
    this.logger = logger
  }

  async run({ maxSteps = 100 } = {}) {
    let steps = 0
    let progressed = true
    while (progressed && steps < maxSteps) {
      progressed = await this.step()
      steps += 1
    }
    return { steps, state: this.state }
  }

  async step() {
    if (this.releasePlannedTasks()) {
      await this.persist()
      return true
    }
    const readyTask = this.state.tasks.find((task) => task.status === 'ready')
    if (readyTask) {
      await this.dispatchReadyTask(readyTask)
      await this.persist()
      return true
    }
    const activeTask = this.state.tasks.find((task) => task.status === 'dispatched')
    if (activeTask) {
      await this.waitForLifecycleEvent()
      await this.persist()
      return true
    }
    return false
  }

  releasePlannedTasks() {
    let releasedAny = false
    for (const task of this.state.tasks) {
      if (task.status !== 'planned' || (task.dependsOn ?? []).length > 0) {
        continue
      }
      transitionTask(task, 'ready', { reason: 'no dependencies' }, this.now())
      releasedAny = true
    }
    return releasedAny
  }

  async dispatchReadyTask(task) {
    requireDispatchApprovalPrecondition(this.state)
    const terminalHandle = await this.resolveWorkerTerminal(task)
    if (!task.orcaTaskId) {
      const created = await this.orca.taskCreate(buildTaskSpec(this.state, task))
      if (!created.taskId) {
        throw new Error(`Orca task-create did not return a task id for ${task.id}`)
      }
      task.orcaTaskId = created.taskId
    }
    await this.orca.taskList()
    const dispatched = await this.orca.dispatch(task.orcaTaskId, terminalHandle)
    if (!dispatched.dispatchId) {
      throw new Error(`Orca dispatch did not return a dispatch id for ${task.id}`)
    }
    task.dispatchId = dispatched.dispatchId
    task.worker ??= {}
    task.worker.terminalHandle = terminalHandle
    task.attempts ??= []
    task.attempts.push({
      orcaTaskId: task.orcaTaskId,
      dispatchId: task.dispatchId,
      terminalHandle,
      at: this.now().toISOString()
    })
    await this.orca.dispatchShow(task.orcaTaskId)
    transitionTask(
      task,
      'dispatched',
      { orcaTaskId: task.orcaTaskId, dispatchId: task.dispatchId, terminalHandle },
      this.now()
    )
  }

  async resolveWorkerTerminal(task) {
    const terminals = allTerminals(await this.orca.terminalList())
    const currentHandle = task.worker?.terminalHandle
    const current = terminals.find((terminal) => terminal.handle === currentHandle)
    if (current) {
      await this.orca.terminalWait(current.handle)
      return current.handle
    }
    const replacement = terminals.find((terminal) => terminalMatchesTask(terminal, task))
    if (replacement?.handle) {
      task.worker ??= {}
      task.worker.previousTerminalHandle = currentHandle
      task.worker.terminalHandle = replacement.handle
      task.worker.reResolvedAt = this.now().toISOString()
      await this.orca.terminalWait(replacement.handle)
      return replacement.handle
    }
    if (task.worker?.create === true) {
      const created = await this.orca.worktreeCreate({
        name: task.worker.worktreeName ?? task.id,
        agentId: task.worker.agentId ?? 'codex'
      })
      const startupTerminal = extractStartupTerminal(created)
      if (!startupTerminal?.handle) {
        throw new Error(`worker creation did not return a startup terminal handle for ${task.id}`)
      }
      task.worker.terminalHandle = startupTerminal.handle
      task.worker.createdAt = this.now().toISOString()
      task.worker.createdWorktreeId = created.id ?? created.worktree?.id ?? created.worktreeId
      task.worktree ??= {}
      task.worktree.path = created.path ?? created.worktree?.path ?? task.worktree.path
      task.worktree.orcaWorktreeId = task.worker.createdWorktreeId
      await this.orca.terminalWait(startupTerminal.handle)
      return startupTerminal.handle
    }
    throw new Error(`no concrete worker terminal handle resolved for ${task.id}`)
  }

  async waitForLifecycleEvent() {
    const result = await this.orca.checkWait(this.state.settings.waitTimeoutMs)
    const messages = extractMessages(result)
    if (messages.length === 0) {
      this.recordCheckpoint('timeout')
      await this.inspectActiveDispatches()
      return
    }
    for (const message of messages) {
      await this.processLifecycleMessage(message)
    }
  }

  async inspectActiveDispatches() {
    for (const task of this.state.tasks.filter((candidate) => candidate.status === 'dispatched')) {
      try {
        task.lastDispatchInspection = await this.orca.dispatchShow(task.orcaTaskId)
      } catch (error) {
        task.lastDispatchInspectionError = error.message
      }
    }
  }

  recordCheckpoint(reason) {
    this.state.checkpoints.push({
      at: this.now().toISOString(),
      reason
    })
  }

  async processLifecycleMessage(message) {
    const id = messageId(message)
    if (this.state.processedMessages.includes(id)) {
      this.state.lifecycleEvents.push({
        at: this.now().toISOString(),
        messageId: id,
        result: 'duplicate_ignored'
      })
      return
    }
    if (message.type === 'worker_done') {
      await this.processWorkerDone(message, id)
      return
    }
    if (message.type === 'decision_gate') {
      await this.processDecisionGate(message, id)
      return
    }
    if (message.type === 'escalation') {
      this.blockForUser(message, id, 'worker escalation')
    }
  }

  async processWorkerDone(message, id) {
    const task = findTaskByOrcaIds(this.state, message)
    if (!task) {
      this.state.lifecycleEvents.push({
        at: this.now().toISOString(),
        messageId: id,
        result: 'stale_worker_done_rejected',
        taskId: messagePayload(message).taskId,
        dispatchId: messagePayload(message).dispatchId
      })
      this.state.processedMessages.push(id)
      return
    }
    this.state.processedMessages.push(id)
    task.workerDone = messagePayload(message)
    transitionTask(task, 'worker_completed', { messageId: id }, this.now())
    transitionTask(task, 'under_verification', { messageId: id }, this.now())
    await this.reviewTask(task, message)
  }

  async processDecisionGate(message, id) {
    const payload = messagePayload(message)
    const task = this.state.tasks.find((candidate) => candidate.orcaTaskId === payload.taskId)
    if (!task) {
      this.state.processedMessages.push(id)
      return
    }
    const reply = task.autoReplies?.[payload.questionId] ?? task.autoReplies?.[message.subject]
    if (reply) {
      await this.orca.reply(id, reply)
      this.state.lifecycleEvents.push({
        at: this.now().toISOString(),
        messageId: id,
        result: 'decision_gate_replied',
        taskId: task.id
      })
      this.state.processedMessages.push(id)
      return
    }
    this.blockForUser(message, id, 'unresolved worker question')
  }

  blockForUser(message, id, reason) {
    const payload = messagePayload(message)
    const task = this.state.tasks.find((candidate) => candidate.orcaTaskId === payload.taskId)
    if (task && task.status === 'dispatched') {
      transitionTask(task, 'blocked_pending_user_decision', { reason, messageId: id }, this.now())
      task.pendingDecision = payload.question ?? payload.body ?? message.subject ?? reason
    }
    this.state.lifecycleEvents.push({
      at: this.now().toISOString(),
      messageId: id,
      result: 'blocked_pending_user_decision',
      reason
    })
    this.state.processedMessages.push(id)
  }

  async reviewTask(task, workerDoneMessage) {
    const contractPath = this.state.contract.path ?? path.join('.qfoundry', 'PROJECT_CONTRACT.md')
    const contractText = await readTextIfExists(resolveProjectPath(this.projectRoot, contractPath))
    const workerReportText = await readWorkerReport(this.projectRoot, task.reportPath)
    const diffText = await this.readDiff(task)
    const review = await this.reviewer.review({
      projectRoot: this.projectRoot,
      contractText,
      task,
      workerDone: messagePayload(workerDoneMessage),
      diffText,
      workerReportText
    })
    review.verdict = normalizeVerdict(review.verdict)
    task.reviewReportPath = await writeReviewReport(this.projectRoot, task, review, this.now())
    task.lastReview = review
    if (review.verdict === 'accepted' || review.verdict === 'accepted_with_follow_up') {
      transitionTask(task, review.verdict, { reviewReportPath: task.reviewReportPath }, this.now())
      this.acceptOriginalAfterCorrection(task, review)
      releaseReadyDependents(this.state, task.correctionOf ?? task.id, this.now())
      return
    }
    if (review.verdict === 'rejected') {
      this.rejectAndCreateCorrection(task, review)
      return
    }
    transitionTask(
      task,
      'blocked_pending_user_decision',
      { reviewReportPath: task.reviewReportPath },
      this.now()
    )
  }

  async readDiff(task) {
    if (task.diffPath) {
      return await readTextIfExists(resolveProjectPath(this.projectRoot, task.diffPath))
    }
    return ''
  }

  acceptOriginalAfterCorrection(task, review) {
    if (!task.correctionOf) {
      return
    }
    const original = this.state.tasks.find((candidate) => candidate.id === task.correctionOf)
    if (!original || original.status !== 'correction_dispatched') {
      return
    }
    transitionTask(
      original,
      review.verdict,
      { correctedBy: task.id, reviewReportPath: task.reviewReportPath },
      this.now()
    )
  }

  rejectAndCreateCorrection(task, review) {
    task.failedRequirements = review.failedRequirements ?? []
    task.failedAcceptanceCriteria = review.failedAcceptanceCriteria ?? []
    task.rejectionEvidence = review.evidence ?? []
    const original = task.correctionOf
      ? this.state.tasks.find((candidate) => candidate.id === task.correctionOf)
      : task
    if (!original) {
      transitionTask(
        task,
        'blocked_pending_user_decision',
        { reason: 'missing original task' },
        this.now()
      )
      return
    }
    original.correctionRounds = (original.correctionRounds ?? 0) + 1
    if (original.correctionRounds > this.state.settings.maxCorrectionRounds) {
      transitionTask(
        task,
        'blocked_pending_user_decision',
        { reason: 'correction retry limit reached', reviewReportPath: task.reviewReportPath },
        this.now()
      )
      if (original.status === 'correction_dispatched') {
        transitionTask(
          original,
          'blocked_pending_user_decision',
          { reason: 'correction retry limit reached', failedCorrection: task.id },
          this.now()
        )
      }
      return
    }
    transitionTask(task, 'rejected', { reviewReportPath: task.reviewReportPath }, this.now())
    const correctionTask = this.createCorrectionTask(original, task, review)
    if (original.status === 'rejected') {
      transitionTask(
        original,
        'correction_dispatched',
        { correctionTaskId: correctionTask.id },
        this.now()
      )
    } else {
      this.state.lifecycleEvents.push({
        at: this.now().toISOString(),
        result: 'additional_correction_dispatched',
        originalTaskId: original.id,
        correctionTaskId: correctionTask.id
      })
    }
  }

  createCorrectionTask(original, rejectedTask, review) {
    const correctionIndex = (original.corrections ?? []).length + 1
    const correctionTask = {
      ...original,
      id: `${original.id}-CORR-${String(correctionIndex).padStart(3, '0')}`,
      title: `Correction for ${original.id}`,
      status: 'ready',
      correctionOf: original.id,
      correctionRounds: 0,
      dependsOn: [],
      orcaTaskId: null,
      dispatchId: null,
      workerDone: null,
      lastReview: null,
      reviewReportPath: null,
      transitions: [],
      corrections: undefined,
      correctionInstructions: {
        rejectedTaskId: rejectedTask.id,
        failedRequirements: review.failedRequirements ?? [],
        failedAcceptanceCriteria: review.failedAcceptanceCriteria ?? [],
        evidence: review.evidence ?? [],
        expectedCorrection:
          review.expectedCorrection ?? review.summary ?? 'Correct the failed evidence.'
      }
    }
    original.corrections ??= []
    original.corrections.push(correctionTask.id)
    this.state.tasks.push(correctionTask)
    return correctionTask
  }

  async persist() {
    await saveControllerState(this.projectRoot, this.state, this.statePath)
  }
}
