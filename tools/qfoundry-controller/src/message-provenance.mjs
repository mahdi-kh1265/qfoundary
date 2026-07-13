export function currentAttempt(task) {
  return task.currentAttemptId
    ? task.attempts?.find((candidate) => candidate.id === task.currentAttemptId)
    : task.attempts?.at(-1)
}

export function senderTerminalHandle(message, messagePayload) {
  const payload = messagePayload(message)
  return (
    payload.senderTerminalHandle ??
    payload.terminalHandle ??
    payload.fromTerminal ??
    payload.sender?.terminalHandle ??
    message.senderTerminalHandle ??
    message.terminalHandle ??
    message.fromTerminal ??
    message.sender?.terminalHandle ??
    null
  )
}

function reportPathFromMessage(message, messagePayload) {
  const payload = messagePayload(message)
  return payload.reportPath ?? payload.report?.path ?? message.reportPath ?? null
}

export function validateLifecycleProvenance(
  task,
  message,
  messagePayload,
  { requireReportPath = false } = {}
) {
  const payload = messagePayload(message)
  const mismatches = []
  if (payload.taskId !== task.orcaTaskId) {
    mismatches.push(`task id mismatch: expected ${task.orcaTaskId}, got ${payload.taskId}`)
  }
  if (payload.dispatchId !== task.dispatchId) {
    mismatches.push(`dispatch id mismatch: expected ${task.dispatchId}, got ${payload.dispatchId}`)
  }
  const attempt = currentAttempt(task)
  if (!attempt || attempt.dispatchId !== task.dispatchId) {
    mismatches.push('message does not match the current task attempt')
  }
  const sender = senderTerminalHandle(message, messagePayload)
  const expectedSender = attempt?.terminalHandle ?? task.worker?.terminalHandle
  if (sender && expectedSender && sender !== expectedSender) {
    mismatches.push(`sender terminal mismatch: expected ${expectedSender}, got ${sender}`)
  }
  const reportPath = reportPathFromMessage(message, messagePayload)
  if (requireReportPath && task.reportPath && reportPath !== task.reportPath) {
    mismatches.push(
      `report path mismatch: expected ${task.reportPath}, got ${reportPath ?? 'none'}`
    )
  }
  return {
    ok: mismatches.length === 0,
    mismatches,
    senderTerminalHandle: sender,
    reportPath,
    attempt
  }
}
