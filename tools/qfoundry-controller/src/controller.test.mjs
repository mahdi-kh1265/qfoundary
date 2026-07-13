import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { QFoundryController } from './controller.mjs'
import { loadControllerState, saveControllerState } from './state-store.mjs'

const tempDirs = []

function makeTempProject() {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'qfoundry-controller-'))
  tempDirs.push(projectRoot)
  mkdirSync(path.join(projectRoot, '.qfoundry', 'reports'), { recursive: true })
  writeFileSync(
    path.join(projectRoot, '.qfoundry', 'PROJECT_CONTRACT.md'),
    '# Contract\n\nStatus: approved\n\nREQ-001 and AC-001 require correct CSV escaping.\n',
    'utf8'
  )
  runGit(projectRoot, ['init'])
  runGit(projectRoot, ['config', 'user.email', 'qfoundry@example.test'])
  runGit(projectRoot, ['config', 'user.name', 'qFoundry Test'])
  runGit(projectRoot, ['add', '.qfoundry/PROJECT_CONTRACT.md'])
  runGit(projectRoot, ['commit', '-m', 'Initial qFoundry contract'])
  return projectRoot
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

function csvAssertion() {
  return `
    import { escapeCsv } from './csv.mjs'
    const got = escapeCsv('a,"b')
    if (got !== '"a,""b"') {
      console.error('expected escaped quoted field, got ' + got)
      process.exit(2)
    }
  `
}

function approvedState(projectRoot, extra = {}) {
  return {
    schemaVersion: 1,
    projectName: 'qFoundry Controller Test',
    contract: {
      path: '.qfoundry/PROJECT_CONTRACT.md',
      status: 'approved',
      approval: {
        attributedTo: 'user',
        decisionRecordId: 'DEC-001',
        approvalGateResolved: true
      }
    },
    settings: {
      waitTimeoutMs: 900_000,
      maxCorrectionRounds: 3,
      ...extra.settings
    },
    processedMessages: [],
    lifecycleEvents: [],
    checkpoints: [],
    tasks: [
      {
        id: 'QF-TASK-001',
        title: 'Implement CSV escaping',
        objective: 'Quote fields containing comma or quote characters.',
        status: 'ready',
        requirements: ['REQ-001'],
        acceptanceCriteria: ['AC-001'],
        requiredTests: ['node csv assertion'],
        verificationCommands: [
          {
            command: process.execPath,
            args: ['--input-type=module', '-e', csvAssertion()],
            cwd: '.',
            timeoutMs: 5_000,
            expectedExitCode: 0
          }
        ],
        permittedScope: ['csv.mjs'],
        prohibitedActions: ['push', 'deploy', 'network'],
        reportPath: '.qfoundry/reports/worker.md',
        worktree: { path: projectRoot },
        worker: { agentId: 'codex', terminalHandle: 'term-old', worktreePath: projectRoot },
        ...extra.task
      }
    ]
  }
}

class FakeOrca {
  constructor(projectRoot) {
    this.projectRoot = projectRoot
    this.taskCount = 0
    this.dispatchCount = 0
    this.tasks = []
    this.dispatches = []
    this.queue = []
    this.replies = []
    this.calls = []
    this.terminalSends = []
    this.terminals = [{ handle: 'term-old', cwd: projectRoot, agentId: 'codex' }]
  }

  async taskCreate(spec) {
    this.taskCount += 1
    const taskId = `task_${this.taskCount}`
    this.tasks.push({ id: taskId, spec })
    this.calls.push({ name: 'taskCreate', spec })
    return { taskId, raw: { task: { id: taskId } } }
  }

  async taskList() {
    this.calls.push({ name: 'taskList' })
    return { tasks: this.tasks }
  }

  async terminalList() {
    this.calls.push({ name: 'terminalList' })
    return { terminals: this.terminals }
  }

  async terminalWait(handle) {
    this.calls.push({ name: 'terminalWait', handle })
    if (this.terminalWaitResult) {
      return this.terminalWaitResult
    }
    return { handle, ready: true }
  }

  async terminalSendEnter(handle) {
    this.terminalSends.push({ handle, enter: true })
    this.calls.push({ name: 'terminalSendEnter', handle })
    return { send: { accepted: true } }
  }

  async worktreeCreate({ name, agentId }) {
    const handle = `term-created-${this.dispatchCount + 1}`
    this.calls.push({ name: 'worktreeCreate', worktreeName: name, agentId, handle })
    this.terminals.push({ handle, cwd: this.projectRoot, agentId })
    return {
      id: `worktree-${name}`,
      path: this.projectRoot,
      startupTerminal: { handle }
    }
  }

  async terminalCreate({ worktree, title, command }) {
    const handle = `term-custom-${this.dispatchCount + 1}`
    this.calls.push({ name: 'terminalCreate', worktree, title, command, handle })
    this.terminals.push({ handle, cwd: this.projectRoot, agentId: 'qfoundry-codex-worker' })
    return { terminal: { handle } }
  }

  async dispatch(taskId, terminalHandle) {
    this.dispatchCount += 1
    const dispatchId = `ctx_${this.dispatchCount}`
    this.dispatches.push({ id: dispatchId, taskId, terminalHandle })
    this.calls.push({ name: 'dispatch', taskId, terminalHandle, dispatchId })
    return { dispatchId, raw: { dispatch: { id: dispatchId } } }
  }

  async dispatchShow(taskId) {
    this.calls.push({ name: 'dispatchShow', taskId })
    return { dispatches: this.dispatches.filter((dispatch) => dispatch.taskId === taskId) }
  }

  async checkWait(timeoutMs) {
    this.calls.push({ name: 'checkWait', timeoutMs })
    return this.queue.shift() ?? { messages: [] }
  }

  async reply(messageId, body) {
    this.replies.push({ messageId, body })
    return { message: { id: messageId, body } }
  }
}

class CsvEvidenceReviewer {
  async review({ projectRoot }) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', csvAssertion()], {
      cwd: projectRoot,
      encoding: 'utf8'
    })
    if (result.status === 0) {
      return {
        verdict: 'accepted',
        summary: 'CSV escaping passed the independent Node assertion.',
        failedRequirements: [],
        failedAcceptanceCriteria: [],
        testsRun: ['node --input-type=module -e <csv assertion>'],
        evidence: ['escapeCsv returned the quoted and doubled-quote value.']
      }
    }
    return {
      verdict: 'rejected',
      summary: 'CSV escaping failed independent verification.',
      failedRequirements: ['REQ-001'],
      failedAcceptanceCriteria: ['AC-001'],
      testsRun: ['node --input-type=module -e <csv assertion>'],
      evidence: [result.stderr.trim() || 'node assertion failed'],
      expectedCorrection:
        'Quote fields containing comma or quote characters and double embedded quotes.'
    }
  }
}

class ConstantReviewer {
  constructor(verdict) {
    this.verdict = verdict
  }

  async review() {
    return {
      verdict: this.verdict,
      summary: `${this.verdict} by test reviewer`,
      failedRequirements: this.verdict === 'rejected' ? ['REQ-001'] : [],
      failedAcceptanceCriteria: this.verdict === 'rejected' ? ['AC-001'] : [],
      testsRun: ['simulated reviewer'],
      evidence: [`reviewer returned ${this.verdict}`]
    }
  }
}

async function runWithState(projectRoot, state, orca, reviewer, maxSteps = 1) {
  const controller = new QFoundryController({
    projectRoot,
    state,
    orca,
    reviewer,
    statePath: '.qfoundry/controller-state.json'
  })
  await controller.run({ maxSteps })
  return controller.state
}

function workerDone(id, taskId, dispatchId, extraPayload = {}) {
  return {
    id,
    type: 'worker_done',
    payload: {
      taskId,
      dispatchId,
      reportPath: '.qfoundry/reports/worker.md',
      ...extraPayload
    }
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true })
  }
})

describe('qFoundry controller loop', () => {
  it('rejects defective worker output, dispatches a correction, and recovers after restart', async () => {
    const projectRoot = makeTempProject()
    const orca = new FakeOrca(projectRoot)
    let state = approvedState(projectRoot)
    await saveControllerState(projectRoot, state)

    state = await loadControllerState(projectRoot)
    await runWithState(projectRoot, state, orca, new CsvEvidenceReviewer(), 1)
    expect(state.tasks[0].status).toBe('dispatched')
    expect(state.tasks[0].dispatchId).toBe('ctx_1')

    writeFileSync(
      path.join(projectRoot, 'csv.mjs'),
      'export function escapeCsv(value) { return String(value) }\n',
      'utf8'
    )
    writeFileSync(
      path.join(projectRoot, '.qfoundry', 'reports', 'worker.md'),
      'defective\n',
      'utf8'
    )
    orca.terminals = [{ handle: 'term-new', cwd: projectRoot, agentId: 'codex' }]
    orca.queue.push({ messages: [workerDone('done-1', 'task_1', 'ctx_1')] })

    state = await loadControllerState(projectRoot)
    await runWithState(projectRoot, state, orca, new CsvEvidenceReviewer(), 2)
    expect(state.tasks[0].status).toBe('correction_dispatched')
    const correction = state.tasks.find((task) => task.correctionOf === 'QF-TASK-001')
    expect(correction.status).toBe('dispatched')
    expect(correction.dispatchId).toBe('ctx_2')
    expect(correction.worker.terminalHandle).toBe('term-new')

    writeFileSync(
      path.join(projectRoot, 'csv.mjs'),
      `export function escapeCsv(value) {
  const text = String(value)
  return /[",\\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
}
`,
      'utf8'
    )
    orca.queue.push({
      messages: [workerDone('done-2', correction.orcaTaskId, correction.dispatchId)]
    })

    state = await loadControllerState(projectRoot)
    await runWithState(projectRoot, state, orca, new CsvEvidenceReviewer(), 1)
    expect(state.tasks[0].status).toBe('accepted')
    expect(state.tasks.find((task) => task.id === correction.id).status).toBe('accepted')
    expect(state.tasks[0].transitions.map((transition) => transition.to)).toEqual([
      'dispatched',
      'worker_completed',
      'under_verification',
      'rejected',
      'correction_dispatched',
      'accepted'
    ])
  })

  it('rejects stale worker_done and ignores duplicate completion messages', async () => {
    const projectRoot = makeTempProject()
    const orca = new FakeOrca(projectRoot)
    const state = approvedState(projectRoot)
    await runWithState(projectRoot, state, orca, new ConstantReviewer('accepted'), 1)
    writeFileSync(
      path.join(projectRoot, 'csv.mjs'),
      `export function escapeCsv(value) {
  const text = String(value)
  return /[",\\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
}
`,
      'utf8'
    )

    orca.queue.push({
      messages: [
        workerDone('stale', 'task_1', 'ctx_stale'),
        workerDone('valid', 'task_1', 'ctx_1'),
        workerDone('valid', 'task_1', 'ctx_1')
      ]
    })
    await runWithState(projectRoot, state, orca, new ConstantReviewer('accepted'), 1)
    expect(state.tasks[0].status).toBe('accepted')
    expect(state.lifecycleEvents.map((event) => event.result)).toContain(
      'stale_worker_done_rejected'
    )
    expect(state.lifecycleEvents.map((event) => event.result)).toContain('duplicate_ignored')
  })

  it('routes answered worker questions through reply and blocks unresolved questions', async () => {
    const projectRoot = makeTempProject()
    const orca = new FakeOrca(projectRoot)
    const state = approvedState(projectRoot, {
      task: { autoReplies: { 'Q-1': 'Use UTC for the timestamp.' } }
    })
    await runWithState(projectRoot, state, orca, new ConstantReviewer('accepted'), 1)

    orca.queue.push({
      messages: [
        {
          id: 'question-1',
          type: 'decision_gate',
          subject: 'Timestamp zone',
          payload: { taskId: 'task_1', dispatchId: 'ctx_1', questionId: 'Q-1' }
        }
      ]
    })
    await runWithState(projectRoot, state, orca, new ConstantReviewer('accepted'), 1)
    expect(orca.replies).toEqual([{ messageId: 'question-1', body: 'Use UTC for the timestamp.' }])
    expect(state.tasks[0].status).toBe('dispatched')

    orca.queue.push({
      messages: [
        {
          id: 'question-2',
          type: 'decision_gate',
          subject: 'Need product decision',
          payload: { taskId: 'task_1', dispatchId: 'ctx_1', questionId: 'Q-2' }
        }
      ]
    })
    await runWithState(projectRoot, state, orca, new ConstantReviewer('accepted'), 1)
    expect(state.tasks[0].status).toBe('blocked_pending_user_decision')
  })

  it('creates a worker terminal when a ready task explicitly requests one', async () => {
    const projectRoot = makeTempProject()
    const orca = new FakeOrca(projectRoot)
    orca.terminals = []
    const state = approvedState(projectRoot, {
      task: {
        worktree: {},
        worker: {
          agentId: 'codex',
          create: true,
          worktreeName: 'qf-worker-create'
        }
      }
    })
    await runWithState(projectRoot, state, orca, new ConstantReviewer('accepted'), 1)
    expect(orca.calls.map((call) => call.name).join(',')).toContain('worktreeCreate')
    expect(state.tasks[0].status).toBe('dispatched')
    expect(state.tasks[0].worker.terminalHandle).toBe('term-created-1')
    expect(orca.dispatches[0].terminalHandle).toBe('term-created-1')
  })

  it('blocks after the configured correction retry limit', async () => {
    const projectRoot = makeTempProject()
    const orca = new FakeOrca(projectRoot)
    const state = approvedState(projectRoot, { settings: { maxCorrectionRounds: 1 } })
    await runWithState(projectRoot, state, orca, new ConstantReviewer('rejected'), 1)
    orca.queue.push({ messages: [workerDone('done-1', 'task_1', 'ctx_1')] })
    await runWithState(projectRoot, state, orca, new ConstantReviewer('rejected'), 2)
    const correction = state.tasks.find((task) => task.correctionOf === 'QF-TASK-001')
    expect(correction.status).toBe('dispatched')

    orca.queue.push({
      messages: [workerDone('done-2', correction.orcaTaskId, correction.dispatchId)]
    })
    await runWithState(projectRoot, state, orca, new ConstantReviewer('rejected'), 1)
    expect(state.tasks[0].status).toBe('blocked_pending_user_decision')
    expect(state.tasks.find((task) => task.id === correction.id).status).toBe(
      'blocked_pending_user_decision'
    )
  })

  it('records bounded wait timeouts as checkpoints without failing the task', async () => {
    const projectRoot = makeTempProject()
    const orca = new FakeOrca(projectRoot)
    const state = approvedState(projectRoot)
    await runWithState(projectRoot, state, orca, new ConstantReviewer('accepted'), 1)

    orca.queue.push({ messages: [] })
    await runWithState(projectRoot, state, orca, new ConstantReviewer('accepted'), 1)
    expect(state.tasks[0].status).toBe('dispatched')
    expect(state.checkpoints).toEqual([
      expect.objectContaining({
        reason: 'timeout'
      })
    ])
  })

  it('submits a staged injected dispatch draft once after restart when configured', async () => {
    const projectRoot = makeTempProject()
    const orca = new FakeOrca(projectRoot)
    const state = approvedState(projectRoot, {
      settings: { submitInjectedDispatchEnter: true }
    })
    await runWithState(projectRoot, state, orca, new ConstantReviewer('accepted'), 1)

    await runWithState(projectRoot, state, orca, new ConstantReviewer('accepted'), 1)
    await runWithState(projectRoot, state, orca, new ConstantReviewer('accepted'), 1)

    expect(orca.terminalSends).toEqual([{ handle: 'term-old', enter: true }])
    expect(state.tasks[0].injectedDispatchSubmittedAt).toBeTruthy()
    expect(state.tasks[0].injectedDispatchSubmittedForDispatchId).toBe('ctx_1')
    expect(state.lifecycleEvents.map((event) => event.result)).toContain(
      'injected_dispatch_submitted'
    )
  })

  it('does not treat a stale injected-dispatch timestamp as current dispatch submission', async () => {
    const projectRoot = makeTempProject()
    const orca = new FakeOrca(projectRoot)
    const state = approvedState(projectRoot, {
      settings: { submitInjectedDispatchEnter: true }
    })
    await runWithState(projectRoot, state, orca, new ConstantReviewer('accepted'), 1)
    state.tasks[0].injectedDispatchSubmittedAt = '2026-01-01T00:00:00.000Z'
    state.tasks[0].injectedDispatchSubmittedForDispatchId = 'ctx_old'

    await runWithState(projectRoot, state, orca, new ConstantReviewer('accepted'), 1)

    expect(orca.terminalSends).toEqual([{ handle: 'term-old', enter: true }])
    expect(state.tasks[0].injectedDispatchSubmittedForDispatchId).toBe('ctx_1')
  })

  it('does not send Enter when injected dispatch is already running', async () => {
    const projectRoot = makeTempProject()
    const orca = new FakeOrca(projectRoot)
    orca.terminalWaitResult = { result: { wait: { satisfied: false, status: 'running' } } }
    const state = approvedState(projectRoot, {
      settings: { submitInjectedDispatchEnter: true }
    })
    await runWithState(projectRoot, state, orca, new ConstantReviewer('accepted'), 1)

    await runWithState(projectRoot, state, orca, new ConstantReviewer('accepted'), 1)

    expect(orca.terminalSends).toEqual([])
    expect(state.tasks[0].injectedDispatchSubmittedForDispatchId).toBe('ctx_1')
    expect(state.lifecycleEvents.map((event) => event.result)).toContain(
      'injected_dispatch_already_running'
    )
  })
})
