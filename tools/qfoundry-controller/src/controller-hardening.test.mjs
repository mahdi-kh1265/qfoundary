import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { QFoundryController } from './controller.mjs'
import { captureDispatchBaseline, collectGitEvidence } from './git-evidence.mjs'
import { runProcess } from './process-runner.mjs'
import { CommandReviewer, readWorkerReport } from './reviewer.mjs'
import { isFinalQFoundryState } from './state-machine.mjs'
import { runVerificationCommands } from './verification-runner.mjs'

const tempDirs = []

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

function makeTempProject() {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'qfoundry-hardening-'))
  tempDirs.push(projectRoot)
  mkdirSync(path.join(projectRoot, '.qfoundry', 'reports'), { recursive: true })
  writeFileSync(
    path.join(projectRoot, '.qfoundry', 'PROJECT_CONTRACT.md'),
    '# Contract\n\nREQ-001 and AC-001 require correct CSV escaping.\n',
    'utf8'
  )
  runGit(projectRoot, ['init'])
  runGit(projectRoot, ['config', 'user.email', 'qfoundry@example.test'])
  runGit(projectRoot, ['config', 'user.name', 'qFoundry Test'])
  runGit(projectRoot, ['add', '.qfoundry/PROJECT_CONTRACT.md'])
  runGit(projectRoot, ['commit', '-m', 'Initial qFoundry contract'])
  return projectRoot
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
    projectName: 'qFoundry Hardening Test',
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
        verificationCommands: [
          {
            command: process.execPath,
            args: ['--input-type=module', '-e', csvAssertion()],
            cwd: '.',
            timeoutMs: 5_000,
            expectedExitCode: 0
          }
        ],
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
    this.terminals = [{ handle: 'term-old', cwd: projectRoot, agentId: 'codex' }]
  }

  async taskCreate(spec) {
    this.taskCount += 1
    const taskId = `task_${this.taskCount}`
    this.tasks.push({ id: taskId, spec })
    return { taskId, raw: { task: { id: taskId } } }
  }

  async taskList() {
    return { tasks: this.tasks }
  }

  async terminalList() {
    return { terminals: this.terminals }
  }

  async terminalWait(handle) {
    return { handle, ready: true }
  }

  async worktreeCreate({ name, agentId }) {
    const handle = `term-created-${this.dispatchCount + 1}`
    this.calls.push({ name: 'worktreeCreate', worktreeName: name, agentId, handle })
    this.terminals.push({ handle, cwd: this.projectRoot, agentId })
    return { id: `worktree-${name}`, path: this.projectRoot, startupTerminal: { handle } }
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
    return { dispatchId, raw: { dispatch: { id: dispatchId } } }
  }

  async dispatchShow(taskId) {
    return { dispatches: this.dispatches.filter((dispatch) => dispatch.taskId === taskId) }
  }

  async checkWait() {
    return this.queue.shift() ?? { messages: [] }
  }

  async reply(messageId, body) {
    this.replies.push({ messageId, body })
    return { message: { id: messageId, body } }
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

function reviewInput(projectRoot) {
  return {
    projectRoot,
    contractText: '# Contract',
    task: { id: 'QF-TASK-REVIEW', dispatchId: 'ctx_review' },
    workerDone: {},
    gitEvidence: {},
    verificationEvidence: { ok: true, results: [] },
    workerReportText: ''
  }
}

function makeCodexHelpMock(projectRoot) {
  const filePath = path.join(projectRoot, 'codex-mock.mjs')
  writeFileSync(filePath, 'console.log("--profile --cd --sandbox --ask-for-approval")\n', 'utf8')
  return { command: process.execPath, args: [filePath] }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true })
  }
})

describe('qFoundry controller hardening', () => {
  it('collects real committed, tracked, staged, and untracked Git evidence', async () => {
    const projectRoot = makeTempProject()
    writeFileSync(path.join(projectRoot, 'base.txt'), 'base\n', 'utf8')
    runGit(projectRoot, ['add', 'base.txt'])
    runGit(projectRoot, ['commit', '-m', 'Add base file'])
    const baseline = await captureDispatchBaseline({ worktreePath: projectRoot })

    writeFileSync(path.join(projectRoot, 'committed.txt'), 'committed\n', 'utf8')
    runGit(projectRoot, ['add', 'committed.txt'])
    runGit(projectRoot, ['commit', '-m', 'Worker committed file'])
    writeFileSync(path.join(projectRoot, 'base.txt'), 'base changed\n', 'utf8')
    writeFileSync(path.join(projectRoot, 'staged.txt'), 'staged\n', 'utf8')
    runGit(projectRoot, ['add', 'staged.txt'])
    writeFileSync(path.join(projectRoot, 'artifact.bin'), 'artifact\n', 'utf8')

    const evidence = await collectGitEvidence({
      task: {
        id: 'QF-TASK-GIT',
        orcaTaskId: 'task_git',
        dispatchId: 'ctx_git',
        currentAttemptId: 'attempt_git',
        attempts: [{ id: 'attempt_git', dispatchId: 'ctx_git', dispatchBaseline: baseline }]
      }
    })
    expect(evidence.committedChanges).toContain('committed.txt')
    expect(evidence.trackedModified).toContain('base.txt')
    expect(evidence.stagedModified).toContain('staged.txt')
    expect(evidence.untrackedFiles).toContain('artifact.bin')
    expect(evidence.artifacts[0]).toEqual(
      expect.objectContaining({ path: 'artifact.bin', sha256: expect.any(String) })
    )
  })

  it('fails deterministic verification closed on timeout and caps command output', async () => {
    const projectRoot = makeTempProject()
    const baseline = await captureDispatchBaseline({ worktreePath: projectRoot })
    const task = {
      id: 'QF-TASK-TIMEOUT',
      orcaTaskId: 'task_timeout',
      dispatchId: 'ctx_timeout',
      currentAttemptId: 'attempt_timeout',
      attempts: [{ id: 'attempt_timeout', dispatchId: 'ctx_timeout', dispatchBaseline: baseline }],
      verificationCommands: [
        {
          command: process.execPath,
          args: ['-e', 'setTimeout(() => {}, 5000)'],
          cwd: '.',
          timeoutMs: 100,
          expectedExitCode: 0
        }
      ]
    }
    const verification = await runVerificationCommands({ task })
    expect(verification.ok).toBe(false)
    expect(verification.failures).toContain('verification command 1 timed out')

    const capped = await runProcess({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("x".repeat(10000))'],
      cwd: projectRoot,
      timeoutMs: 5_000,
      maxStdoutBytes: 25
    })
    expect(capped.stdout.length).toBeLessThanOrEqual(25)
    expect(capped.stdoutTruncated).toBe(true)
  })

  it('rejects malformed reviewer JSON and reviewer timeouts', async () => {
    const projectRoot = makeTempProject()
    const malformed = new CommandReviewer({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("{not-json")'],
      timeoutMs: 5_000
    })
    await expect(malformed.review(reviewInput(projectRoot))).rejects.toThrow(
      /must print strict JSON/
    )

    const timeout = new CommandReviewer({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 5000)'],
      timeoutMs: 100
    })
    await expect(timeout.review(reviewInput(projectRoot))).rejects.toThrow(/timed out/)
  })

  it('rejects qFoundry report path traversal', async () => {
    const projectRoot = makeTempProject()
    await expect(readWorkerReport(projectRoot, '../outside.md')).rejects.toThrow(
      /must stay inside project \.qfoundry/
    )
  })

  it('rejects worker_done with mismatched sender handle without accepting the task', async () => {
    const projectRoot = makeTempProject()
    const orca = new FakeOrca(projectRoot)
    const state = approvedState(projectRoot)
    await runWithState(projectRoot, state, orca, new ConstantReviewer('accepted'), 1)
    orca.queue.push({
      messages: [
        workerDone('wrong-sender', 'task_1', 'ctx_1', {
          senderTerminalHandle: 'term-other'
        })
      ]
    })
    await runWithState(projectRoot, state, orca, new ConstantReviewer('accepted'), 1)
    expect(state.tasks[0].status).toBe('dispatched')
    expect(state.lifecycleEvents.map((event) => event.result)).toContain(
      'worker_done_provenance_rejected'
    )
  })

  it('rejects stale worker questions', async () => {
    const projectRoot = makeTempProject()
    const orca = new FakeOrca(projectRoot)
    const state = approvedState(projectRoot)
    await runWithState(projectRoot, state, orca, new ConstantReviewer('accepted'), 1)
    orca.queue.push({
      messages: [
        {
          id: 'question-stale',
          type: 'decision_gate',
          subject: 'stale',
          payload: { taskId: 'task_1', dispatchId: 'ctx_stale', questionId: 'Q-stale' }
        }
      ]
    })
    await runWithState(projectRoot, state, orca, new ConstantReviewer('accepted'), 1)
    expect(state.tasks[0].status).toBe('dispatched')
    expect(state.lifecycleEvents.map((event) => event.result)).toContain('stale_question_rejected')
  })

  it('answers and resumes a pending decision without duplicate dispatch', async () => {
    const projectRoot = makeTempProject()
    const orca = new FakeOrca(projectRoot)
    const state = approvedState(projectRoot)
    await runWithState(projectRoot, state, orca, new ConstantReviewer('accepted'), 1)
    orca.queue.push({
      messages: [
        {
          id: 'question-open',
          type: 'decision_gate',
          subject: 'Choose behavior',
          payload: {
            taskId: 'task_1',
            dispatchId: 'ctx_1',
            questionId: 'Q-open',
            question: 'Which behavior should be used?',
            options: ['A', 'B']
          }
        }
      ]
    })
    await runWithState(projectRoot, state, orca, new ConstantReviewer('accepted'), 1)
    const decision = state.pendingDecisions[0]
    expect(decision.status).toBe('pending')
    expect(state.tasks[0].status).toBe('blocked_pending_user_decision')
    const dispatchCount = orca.dispatchCount

    const controller = new QFoundryController({
      projectRoot,
      state,
      orca,
      reviewer: new ConstantReviewer('accepted'),
      statePath: '.qfoundry/controller-state.json'
    })
    await controller.answerDecision(decision.id, 'A')
    expect(state.pendingDecisions[0].status).toBe('answered')
    expect(state.tasks[0].status).toBe('dispatched')
    expect(orca.dispatchCount).toBe(dispatchCount)
    await expect(controller.answerDecision(decision.id, 'B')).rejects.toThrow(/not active/)
  })

  it('treats blocked_pending_user_decision as resumable, not final', () => {
    expect(isFinalQFoundryState('blocked_pending_user_decision')).toBe(false)
  })

  it('launches a requested qfoundry-codex-worker with a generated scoped profile', async () => {
    const projectRoot = makeTempProject()
    const codexMock = makeCodexHelpMock(projectRoot)
    const orca = new FakeOrca(projectRoot)
    orca.terminals = []
    const state = approvedState(projectRoot, {
      task: {
        worktree: {},
        worker: {
          agentId: 'qfoundry-codex-worker',
          create: true,
          worktreeName: 'qf-profiled-worker',
          codexCommand: codexMock.command,
          codexCommandArgs: codexMock.args
        }
      }
    })
    await runWithState(projectRoot, state, orca, new ConstantReviewer('accepted'), 1)
    const terminalCreate = orca.calls.find((call) => call.name === 'terminalCreate')
    expect(terminalCreate.command).toContain('--profile')
    expect(terminalCreate.command).toContain('qfoundry-worker')
    expect(readFileSync(state.tasks[0].worker.profileEvidence.profilePath, 'utf8')).toContain(
      projectRoot.replaceAll('\\', '/')
    )
  })
})
