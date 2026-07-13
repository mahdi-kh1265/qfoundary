export const QFOUNDRY_STATES = Object.freeze([
  'planned',
  'ready',
  'dispatched',
  'worker_completed',
  'under_verification',
  'accepted',
  'accepted_with_follow_up',
  'rejected',
  'correction_dispatched',
  'blocked_pending_user_decision',
  'failed',
  'abandoned'
])

const FINAL_STATES = new Set(['accepted', 'accepted_with_follow_up', 'failed', 'abandoned'])

const ALLOWED_TRANSITIONS = Object.freeze({
  planned: ['ready', 'blocked_pending_user_decision', 'abandoned'],
  ready: ['dispatched', 'blocked_pending_user_decision', 'abandoned'],
  dispatched: ['worker_completed', 'blocked_pending_user_decision', 'failed', 'abandoned'],
  worker_completed: ['under_verification', 'failed'],
  under_verification: [
    'accepted',
    'accepted_with_follow_up',
    'rejected',
    'correction_dispatched',
    'blocked_pending_user_decision',
    'failed'
  ],
  rejected: ['correction_dispatched', 'blocked_pending_user_decision', 'failed'],
  correction_dispatched: ['accepted', 'accepted_with_follow_up', 'blocked_pending_user_decision'],
  blocked_pending_user_decision: ['ready', 'dispatched', 'abandoned'],
  accepted: [],
  accepted_with_follow_up: [],
  failed: [],
  abandoned: []
})

export function isFinalQFoundryState(status) {
  return FINAL_STATES.has(status)
}

export function assertKnownState(status) {
  if (!QFOUNDRY_STATES.includes(status)) {
    throw new Error(`unknown qFoundry state: ${status}`)
  }
}

export function canTransition(from, to) {
  assertKnownState(from)
  assertKnownState(to)
  return ALLOWED_TRANSITIONS[from].includes(to)
}

export function transitionTask(task, to, evidence = {}, now = new Date()) {
  const from = task.status
  if (!canTransition(from, to)) {
    throw new Error(`invalid qFoundry transition for ${task.id}: ${from} -> ${to}`)
  }
  const timestamp = now.toISOString()
  task.status = to
  task.updatedAt = timestamp
  task.transitions ??= []
  task.transitions.push({
    at: timestamp,
    from,
    to,
    evidence
  })
}

export function requireDispatchApprovalPrecondition(state) {
  const contract = state.contract ?? {}
  const approval = contract.approval ?? {}
  const missing = []
  if (contract.status !== 'approved') {
    missing.push('contract status must be approved')
  }
  if (approval.attributedTo !== 'user') {
    missing.push('approval must be explicitly attributable to the user')
  }
  if (!/^DEC-[A-Za-z0-9-]+$/.test(approval.decisionRecordId ?? '')) {
    missing.push('a DEC-* decision record must exist')
  }
  if (approval.approvalGateResolved !== true) {
    missing.push('any approval gate created for the contract must be resolved')
  }
  if (missing.length > 0) {
    const error = new Error(`contract approval precondition failed: ${missing.join('; ')}`)
    error.missing = missing
    throw error
  }
}

export function releaseReadyDependents(state, completedTaskId, now = new Date()) {
  const acceptedStatuses = new Set(['accepted', 'accepted_with_follow_up'])
  const released = []
  for (const task of state.tasks ?? []) {
    if (task.status !== 'planned') {
      continue
    }
    const dependencies = task.dependsOn ?? []
    if (
      dependencies.includes(completedTaskId) &&
      dependencies.every((dependency) => {
        const upstream = state.tasks.find((candidate) => candidate.id === dependency)
        return upstream && acceptedStatuses.has(upstream.status)
      })
    ) {
      transitionTask(task, 'ready', { reason: 'all dependencies accepted', completedTaskId }, now)
      released.push(task.id)
    }
  }
  return released
}

export function normalizeControllerState(raw) {
  const state = {
    schemaVersion: 1,
    projectName: raw.projectName ?? 'qFoundry Project',
    contract: raw.contract ?? {},
    settings: raw.settings ?? {},
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    processedMessages: Array.isArray(raw.processedMessages) ? raw.processedMessages : [],
    lifecycleEvents: Array.isArray(raw.lifecycleEvents) ? raw.lifecycleEvents : [],
    checkpoints: Array.isArray(raw.checkpoints) ? raw.checkpoints : [],
    pendingDecisions: Array.isArray(raw.pendingDecisions) ? raw.pendingDecisions : []
  }
  for (const task of state.tasks) {
    task.status ??= 'planned'
    assertKnownState(task.status)
    task.dependsOn ??= []
    task.correctionRounds ??= 0
    task.transitions ??= []
  }
  state.settings.maxCorrectionRounds ??= 3
  state.settings.waitTimeoutMs ??= 900_000
  return state
}
