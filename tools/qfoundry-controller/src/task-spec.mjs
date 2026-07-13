import { taskWorktreePath } from './terminal-selection.mjs'

function acceptedStatus(status) {
  return status === 'accepted' || status === 'accepted_with_follow_up'
}

export function buildTaskSpec(state, task) {
  const decisions = (state.pendingDecisions ?? [])
    .filter((decision) => decision.status === 'answered' || decision.taskId === task.id)
    .map((decision) => ({
      id: decision.id,
      taskId: decision.taskId,
      question: decision.question,
      answer: decision.answer,
      status: decision.status
    }))
  const dependencyState = (task.dependsOn ?? []).map((dependencyId) => {
    const dependency = state.tasks.find((candidate) => candidate.id === dependencyId)
    return {
      id: dependencyId,
      status: dependency?.status ?? 'missing',
      accepted: acceptedStatus(dependency?.status)
    }
  })
  return JSON.stringify(
    {
      contextPacketVersion: 1,
      qFoundryTaskId: task.id,
      orchestrationIdentity: {
        qFoundryTaskId: task.id,
        orcaTaskId: task.orcaTaskId ?? 'created-before-dispatch',
        dispatchId: 'provided-by-Orca-injected-dispatch-preamble'
      },
      title: task.title,
      objective: task.objective,
      requirements: task.requirements ?? [],
      acceptanceCriteria: task.acceptanceCriteria ?? [],
      relevantDecisions: decisions,
      repository: {
        id: task.repositoryId ?? task.repository?.id ?? null,
        path: task.repository?.path ?? task.worktree?.repositoryRoot ?? null,
        worktree: taskWorktreePath(task)
      },
      permittedScope: task.permittedScope ?? [],
      ownership: task.ownership ?? {
        files: task.ownedFiles ?? task.permittedScope ?? [],
        subsystem: task.subsystem ?? null
      },
      prohibitedActions: task.prohibitedActions ?? [],
      requiredTests: task.requiredTests ?? [],
      deterministicChecks: task.verificationCommands ?? [],
      expectedCompletionReport: {
        reportPath: task.reportPath,
        mustSendWorkerDone: true,
        requiredFields: [
          'task ID',
          'dispatch ID',
          'worker identity',
          'files modified',
          'tests run',
          'test results',
          'assumptions',
          'risks'
        ]
      },
      dependencyState,
      reportPath: task.reportPath,
      projectName: state.projectName,
      correctionOf: task.correctionOf ?? null,
      correctionInstructions: task.correctionInstructions ?? null
    },
    null,
    2
  )
}
