import { transitionTask } from './state-machine.mjs'

export function nextDecisionId(state) {
  const existing = state.pendingDecisions ?? []
  return `DEC-${String(existing.length + 1).padStart(3, '0')}`
}

export function createPendingDecision({
  state,
  task,
  message,
  messageId,
  reason,
  messagePayload,
  senderTerminalHandle,
  now
}) {
  const payload = messagePayload(message)
  const existing = state.pendingDecisions?.find(
    (decision) => decision.orcaMessageId === messageId && decision.status === 'pending'
  )
  if (existing) {
    return { decision: existing, reused: true }
  }
  state.pendingDecisions ??= []
  const decision = {
    id: nextDecisionId(state),
    orcaMessageId: messageId,
    gateId: payload.gateId ?? payload.questionId ?? messageId,
    taskId: task?.id ?? null,
    orcaTaskId: payload.taskId ?? task?.orcaTaskId ?? null,
    dispatchId: payload.dispatchId ?? task?.dispatchId ?? null,
    senderTerminalHandle: senderTerminalHandle(message, messagePayload),
    question: payload.question ?? payload.body ?? message.subject ?? reason,
    options: Array.isArray(payload.options) ? payload.options : [],
    reason,
    createdAt: now().toISOString(),
    status: 'pending',
    answer: null,
    answeredAt: null,
    resumeStatus: task?.status ?? 'dispatched'
  }
  state.pendingDecisions.push(decision)
  if (task && task.status !== 'blocked_pending_user_decision') {
    task.resumeAfterDecisionStatus = task.status
    transitionTask(task, 'blocked_pending_user_decision', { reason, messageId }, now())
  }
  return { decision, reused: false }
}

export async function answerPendingDecision({ state, orca, decisionId, answer, now }) {
  const decision = state.pendingDecisions?.find((candidate) => candidate.id === decisionId)
  if (!decision) {
    throw new Error(`unknown qFoundry decision: ${decisionId}`)
  }
  if (decision.status !== 'pending') {
    throw new Error(`qFoundry decision ${decisionId} is not active`)
  }
  await orca.reply(decision.orcaMessageId ?? decision.gateId, answer)
  decision.status = 'answered'
  decision.answer = answer
  decision.answeredAt = now().toISOString()
  const task = state.tasks.find((candidate) => candidate.id === decision.taskId)
  if (task?.status === 'blocked_pending_user_decision') {
    transitionTask(
      task,
      task.resumeAfterDecisionStatus ?? decision.resumeStatus ?? 'dispatched',
      { decisionId, answer },
      now()
    )
    delete task.resumeAfterDecisionStatus
  }
  return decision
}
