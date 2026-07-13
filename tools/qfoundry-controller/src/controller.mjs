import path from 'node:path'

import { answerPendingDecision, createPendingDecision } from './decision-store.mjs'
import { extractMessages } from './orca-json-cli.mjs'
import { captureDispatchBaseline } from './git-evidence.mjs'
import { messagePayload } from './message-payload.mjs'
import { senderTerminalHandle, validateLifecycleProvenance } from './message-provenance.mjs'
import { saveControllerState } from './state-store.mjs'
import { buildTaskSpec } from './task-spec.mjs'
import {
  releaseReadyDependents,
  requireDispatchApprovalPrecondition,
  transitionTask
} from './state-machine.mjs'
import { buildTaskReview } from './review-flow.mjs'
import { writeReviewReport } from './reviewer.mjs'
import { resolveWorkerTerminal as resolveWorkerTerminalForTask } from './worker-terminal.mjs'
import {
  activeDispatchedTasks,
  applyRateLimitBackoff,
  isRateLimitMessage,
  maxConcurrentWorkers,
  readyDispatchCandidate
} from './scheduler.mjs'
import { taskWorktreePath } from './terminal-selection.mjs'

const REVIEW_VERDICTS = new Set([
  'accepted',
  'accepted_with_follow_up',
  'rejected',
  'blocked_pending_user_decision'
])

function messageId(message) {
  return (
    message.id ?? message.messageId ?? `${message.type}:${message.taskId}:${message.dispatchId}`
  )
}

function sameLifecycleTarget(task, message) {
  const payload = messagePayload(message)
  return payload.taskId === task.orcaTaskId && payload.dispatchId === task.dispatchId
}

function findTaskByOrcaIds(state, message) {
  return state.tasks.find(
    (task) => task.status === 'dispatched' && sameLifecycleTarget(task, message)
  )
}

function findTaskBySenderHandle(state, message) {
  const sender = senderTerminalHandle(message, messagePayload)
  if (!sender) {
    return null
  }
  return (
    state.tasks.find(
      (task) => task.status === 'dispatched' && task.worker?.terminalHandle === sender
    ) ?? null
  )
}

function isSenderOnlyDecisionGateMatch(provenance) {
  return provenance.mismatches.every(
    (mismatch) =>
      mismatch.startsWith('task id mismatch:') || mismatch.startsWith('dispatch id mismatch:')
  )
}

function normalizeVerdict(verdict) {
  return REVIEW_VERDICTS.has(verdict) ? verdict : 'blocked_pending_user_decision'
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
    const dispatches = await this.dispatchReadyTasks()
    if (dispatches > 0) {
      return true
    }
    if (activeDispatchedTasks(this.state).length > 0) {
      await this.waitForLifecycleEvent()
      await this.persist()
      return true
    }
    return false
  }

  releasePlannedTasks() {
    let releasedAny = false
    for (const task of this.state.tasks) {
      if (task.status !== 'planned') {
        continue
      }
      const dependencies = task.dependsOn ?? []
      const ready = dependencies.every((dependency) => {
        const upstream = this.state.tasks.find((candidate) => candidate.id === dependency)
        return upstream && ['accepted', 'accepted_with_follow_up'].includes(upstream.status)
      })
      if (!ready) {
        continue
      }
      transitionTask(
        task,
        'ready',
        { reason: dependencies.length === 0 ? 'no dependencies' : 'all dependencies accepted' },
        this.now()
      )
      releasedAny = true
    }
    return releasedAny
  }

  async dispatchReadyTasks() {
    let dispatched = 0
    while (activeDispatchedTasks(this.state).length < maxConcurrentWorkers(this.state)) {
      const task = readyDispatchCandidate(this.state, this.now())
      if (!task) {
        break
      }
      await this.dispatchReadyTask(task)
      dispatched += 1
      await this.persist()
    }
    return dispatched
  }

  async dispatchReadyTask(task) {
    requireDispatchApprovalPrecondition(this.state)
    const terminalHandle = await this.resolveWorkerTerminal(task)
    const baseline = await captureDispatchBaseline({
      worktreePath: taskWorktreePath(task),
      timeoutMs: this.state.settings.gitTimeoutMs
    })
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
    const attemptId = `${task.id}-ATTEMPT-${String(task.attempts.length + 1).padStart(3, '0')}`
    task.attempts.push({
      id: attemptId,
      qFoundryTaskId: task.id,
      orcaTaskId: task.orcaTaskId,
      dispatchId: task.dispatchId,
      terminalHandle,
      workerWorktreePath: baseline.workerWorktreePath,
      repositoryRoot: baseline.repositoryRoot,
      baseCommitSha: baseline.baseCommitSha,
      branch: baseline.currentBranch,
      dispatchBaseline: baseline,
      at: this.now().toISOString()
    })
    task.currentAttemptId = attemptId
    task.dispatchBaseline = baseline
    await this.orca.dispatchShow(task.orcaTaskId)
    transitionTask(
      task,
      'dispatched',
      { orcaTaskId: task.orcaTaskId, dispatchId: task.dispatchId, terminalHandle },
      this.now()
    )
  }

  async resolveWorkerTerminal(task) {
    return await resolveWorkerTerminalForTask({
      task,
      state: this.state,
      orca: this.orca,
      projectRoot: this.projectRoot,
      now: this.now
    })
  }

  async waitForLifecycleEvent() {
    await this.submitInjectedDispatchDraftIfNeeded()
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

  async submitInjectedDispatchDraftIfNeeded() {
    if (this.state.settings.submitInjectedDispatchEnter !== true) {
      return
    }
    for (const activeTask of activeDispatchedTasks(this.state)) {
      if (activeTask.injectedDispatchSubmittedForDispatchId === activeTask.dispatchId) {
        continue
      }
      const terminalHandle = activeTask.worker?.terminalHandle
      if (!terminalHandle) {
        throw new Error(
          `cannot submit injected dispatch draft without terminal handle for ${activeTask.id}`
        )
      }
      const waitResult = await this.orca.terminalWait(terminalHandle, 1000)
      const wait = waitResult?.result?.wait ?? waitResult?.wait ?? waitResult
      let result = 'injected_dispatch_already_running'
      if (wait?.satisfied !== false) {
        await this.orca.terminalSendEnter(terminalHandle)
        result = 'injected_dispatch_submitted'
      }
      activeTask.injectedDispatchSubmittedAt = this.now().toISOString()
      activeTask.injectedDispatchSubmittedForDispatchId = activeTask.dispatchId
      this.state.lifecycleEvents.push({
        at: activeTask.injectedDispatchSubmittedAt,
        result,
        taskId: activeTask.id,
        dispatchId: activeTask.dispatchId,
        terminalHandle
      })
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
      const task = findTaskByOrcaIds(this.state, message)
      if (task) {
        if (isRateLimitMessage(message, messagePayload)) {
          const backoff = applyRateLimitBackoff(this.state, task, this.now())
          this.state.lifecycleEvents.push({
            at: this.now().toISOString(),
            messageId: id,
            result: 'rate_limit_backoff_recorded',
            taskId: task.id,
            ...backoff
          })
          this.state.processedMessages.push(id)
          return
        }
        this.blockForUser(task, message, id, 'worker escalation')
      } else {
        this.state.lifecycleEvents.push({
          at: this.now().toISOString(),
          messageId: id,
          result: 'stale_escalation_rejected'
        })
        this.state.processedMessages.push(id)
      }
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
    const provenance = validateLifecycleProvenance(task, message, messagePayload, {
      requireReportPath: true
    })
    if (!provenance.ok) {
      this.state.lifecycleEvents.push({
        at: this.now().toISOString(),
        messageId: id,
        result: 'worker_done_provenance_rejected',
        taskId: task.id,
        mismatches: provenance.mismatches
      })
      this.state.processedMessages.push(id)
      return
    }
    this.state.processedMessages.push(id)
    task.workerDone = messagePayload(message)
    task.workerDoneProvenance = provenance
    transitionTask(task, 'worker_completed', { messageId: id }, this.now())
    transitionTask(task, 'under_verification', { messageId: id }, this.now())
    await this.reviewTask(task, message)
  }

  async processDecisionGate(message, id) {
    const payload = messagePayload(message)
    const task =
      findTaskByOrcaIds(this.state, message) ?? findTaskBySenderHandle(this.state, message)
    if (!task) {
      this.state.lifecycleEvents.push({
        at: this.now().toISOString(),
        messageId: id,
        result: 'stale_question_rejected',
        taskId: payload.taskId,
        dispatchId: payload.dispatchId
      })
      this.state.processedMessages.push(id)
      return
    }
    const provenance = validateLifecycleProvenance(task, message, messagePayload)
    if (!provenance.ok && !isSenderOnlyDecisionGateMatch(provenance)) {
      this.state.lifecycleEvents.push({
        at: this.now().toISOString(),
        messageId: id,
        result: 'question_provenance_rejected',
        taskId: task.id,
        mismatches: provenance.mismatches
      })
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
    this.blockForUser(task, message, id, 'unresolved worker question')
  }

  blockForUser(task, message, id, reason) {
    const { decision, reused } = createPendingDecision({
      state: this.state,
      task,
      message,
      messageId: id,
      reason,
      messagePayload,
      senderTerminalHandle,
      now: this.now
    })
    if (reused) {
      this.state.lifecycleEvents.push({
        at: this.now().toISOString(),
        messageId: id,
        result: 'existing_decision_reused',
        decisionId: decision.id
      })
      this.state.processedMessages.push(id)
      return decision
    }
    this.state.lifecycleEvents.push({
      at: this.now().toISOString(),
      messageId: id,
      result: 'blocked_pending_user_decision',
      decisionId: decision.id,
      reason
    })
    this.state.processedMessages.push(id)
    return decision
  }

  async answerDecision(decisionId, answer) {
    const decision = await answerPendingDecision({
      state: this.state,
      orca: this.orca,
      decisionId,
      answer,
      now: this.now
    })
    this.state.lifecycleEvents.push({
      at: this.now().toISOString(),
      result: 'decision_answered',
      decisionId,
      taskId: decision.taskId
    })
    await this.persist()
    return decision
  }

  async reviewTask(task, workerDoneMessage) {
    const review = await buildTaskReview({
      projectRoot: this.projectRoot,
      state: this.state,
      task,
      workerDoneMessage,
      reviewer: this.reviewer,
      messagePayload,
      now: this.now
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
      workerDoneProvenance: null,
      lastReview: null,
      reviewReportPath: null,
      attempts: [],
      currentAttemptId: null,
      dispatchBaseline: null,
      gitEvidence: null,
      verificationEvidence: null,
      transitions: [],
      corrections: undefined,
      injectedDispatchSubmittedAt: null,
      injectedDispatchSubmittedForDispatchId: null,
      lastDispatchInspection: null,
      lastDispatchInspectionError: null,
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
