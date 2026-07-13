import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { QFoundryController } from './controller.mjs'

const tempDirs = []

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

function makeProject(name = 'qfoundry-scheduler-') {
  const projectRoot = mkdtempSync(path.join(tmpdir(), name))
  tempDirs.push(projectRoot)
  mkdirSync(path.join(projectRoot, '.qfoundry', 'reports'), { recursive: true })
  writeFileSync(path.join(projectRoot, '.qfoundry', 'PROJECT_CONTRACT.md'), '# Contract\n', 'utf8')
  runGit(projectRoot, ['init'])
  runGit(projectRoot, ['config', 'user.email', 'qfoundry@example.test'])
  runGit(projectRoot, ['config', 'user.name', 'qFoundry Test'])
  runGit(projectRoot, ['add', '.qfoundry/PROJECT_CONTRACT.md'])
  runGit(projectRoot, ['commit', '-m', 'Initial scheduler project'])
  return projectRoot
}

function baseState(projectRoot, tasks, settings = {}) {
  return {
    schemaVersion: 1,
    projectName: 'qFoundry Scheduler Test',
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
      waitTimeoutMs: 5_000,
      maxConcurrentWorkers: 2,
      maxCorrectionRounds: 1,
      ...settings
    },
    processedMessages: [],
    lifecycleEvents: [],
    checkpoints: [],
    pendingDecisions: [],
    tasks
  }
}

function task(projectRoot, id, extra = {}) {
  return {
    id,
    title: id,
    objective: `Do ${id}`,
    status: 'ready',
    requirements: [`REQ-${id}`],
    acceptanceCriteria: [`AC-${id}`],
    verificationCommands: [],
    permittedScope: [`${id}.txt`],
    reportPath: `.qfoundry/reports/${id}.md`,
    worktree: { path: projectRoot },
    worker: { agentId: 'codex', create: true, worktreeName: `worker-${id}` },
    ...extra
  }
}

class FakeOrca {
  constructor(projectRoot) {
    this.projectRoot = projectRoot
    this.taskCount = 0
    this.dispatchCount = 0
    this.tasks = []
    this.dispatches = []
    this.terminals = []
    this.queue = []
    this.calls = []
  }

  async taskCreate(spec) {
    this.taskCount += 1
    const taskId = `task_${this.taskCount}`
    this.tasks.push({ id: taskId, spec })
    this.calls.push({ name: 'taskCreate', spec })
    return { taskId }
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
    return { handle, ready: true }
  }

  async worktreeCreate({ name, agentId, repo }) {
    const handle = `term-${name}`
    this.calls.push({ name: 'worktreeCreate', worktreeName: name, agentId, repo, handle })
    this.terminals.push({ handle, cwd: this.projectRoot, agentId })
    return { id: `worktree-${name}`, path: this.projectRoot, startupTerminal: { handle } }
  }

  async dispatch(taskId, terminalHandle) {
    this.dispatchCount += 1
    const dispatchId = `ctx_${this.dispatchCount}`
    this.dispatches.push({ id: dispatchId, taskId, terminalHandle })
    this.calls.push({ name: 'dispatch', taskId, terminalHandle, dispatchId })
    return { dispatchId }
  }

  async dispatchShow(taskId) {
    return { dispatches: this.dispatches.filter((dispatch) => dispatch.taskId === taskId) }
  }

  async checkWait() {
    return this.queue.shift() ?? { messages: [] }
  }

  async reply() {
    return { ok: true }
  }
}

class AcceptingReviewer {
  async review() {
    return {
      verdict: 'accepted',
      summary: 'accepted',
      failedRequirements: [],
      failedAcceptanceCriteria: [],
      testsRun: [],
      evidence: ['accepted by scheduler test']
    }
  }
}

async function run(projectRoot, state, orca, maxSteps = 1) {
  const controller = new QFoundryController({
    projectRoot,
    state,
    orca,
    reviewer: new AcceptingReviewer(),
    statePath: '.qfoundry/controller-state.json'
  })
  await controller.run({ maxSteps })
  return state
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true })
  }
})

describe('qFoundry concurrent scheduler', () => {
  it('dispatches up to maxConcurrentWorkers and leaves extra ready tasks undispatched', async () => {
    const projectRoot = makeProject()
    const orca = new FakeOrca(projectRoot)
    const state = baseState(projectRoot, [
      task(projectRoot, 'QF-1'),
      task(projectRoot, 'QF-2'),
      task(projectRoot, 'QF-3')
    ])

    await run(projectRoot, state, orca, 1)

    expect(orca.dispatches).toHaveLength(2)
    expect(state.tasks.map((item) => item.status)).toEqual(['dispatched', 'dispatched', 'ready'])
    expect(new Set(orca.dispatches.map((dispatch) => dispatch.terminalHandle)).size).toBe(2)
  })

  it('skips a ready task that collides with active file ownership', async () => {
    const projectRoot = makeProject()
    const orca = new FakeOrca(projectRoot)
    orca.terminals = [
      { handle: 'term-a', cwd: projectRoot, agentId: 'codex' },
      { handle: 'term-b', cwd: projectRoot, agentId: 'codex' }
    ]
    const state = baseState(projectRoot, [
      task(projectRoot, 'QF-A', {
        permittedScope: ['src/csv'],
        worker: { agentId: 'codex', terminalHandle: 'term-a', worktreePath: projectRoot }
      }),
      task(projectRoot, 'QF-B', {
        permittedScope: ['src/csv/escape.mjs'],
        worker: { agentId: 'codex', terminalHandle: 'term-b', worktreePath: projectRoot }
      })
    ])

    await run(projectRoot, state, orca, 1)

    expect(orca.dispatches).toHaveLength(1)
    expect(state.tasks[1].status).toBe('ready')
    expect(state.tasks[1].schedulingBlocked.reason).toContain('same repository')
  })

  it('allows same file names in different repositories', async () => {
    const projectRoot = makeProject()
    const repoTwo = makeProject('qfoundry-scheduler-repo2-')
    const orca = new FakeOrca(projectRoot)
    const state = baseState(projectRoot, [
      task(projectRoot, 'QF-A', {
        repositoryId: 'repo-one',
        permittedScope: ['src/index.mjs']
      }),
      task(repoTwo, 'QF-B', {
        repositoryId: 'repo-two',
        permittedScope: ['src/index.mjs'],
        worktree: { path: repoTwo }
      })
    ])

    await run(projectRoot, state, orca, 1)

    expect(orca.dispatches).toHaveLength(2)
    expect(state.tasks.every((item) => item.status === 'dispatched')).toBe(true)
  })

  it('releases dependents only after qFoundry acceptance', async () => {
    const projectRoot = makeProject()
    const state = baseState(projectRoot, [
      task(projectRoot, 'QF-A', { status: 'worker_completed' }),
      task(projectRoot, 'QF-B', { status: 'planned', dependsOn: ['QF-A'] })
    ])
    let orca = new FakeOrca(projectRoot)

    await run(projectRoot, state, orca, 1)
    expect(state.tasks[1].status).toBe('planned')

    state.tasks[0].status = 'accepted'
    orca = new FakeOrca(projectRoot)
    await run(projectRoot, state, orca, 1)
    expect(state.tasks[1].status).toBe('ready')
  })

  it('refuses to dispatch a ready dependent task until the dependency is accepted', async () => {
    const projectRoot = makeProject()
    const orca = new FakeOrca(projectRoot)
    const state = baseState(projectRoot, [
      task(projectRoot, 'QF-A', { status: 'worker_completed' }),
      task(projectRoot, 'QF-B', { status: 'ready', dependsOn: ['QF-A'] })
    ])

    await run(projectRoot, state, orca, 1)

    expect(orca.dispatches).toHaveLength(0)
    expect(state.tasks[1].status).toBe('ready')
    expect(state.tasks[1].schedulingBlocked.reason).toBe('dependencies are not yet accepted')
  })

  it('can reuse an accepted dependency worker for dependent follow-up work', async () => {
    const projectRoot = makeProject()
    const reusedWorktree = makeProject('qfoundry-reused-worker-')
    const orca = new FakeOrca(projectRoot)
    orca.terminals = [{ handle: 'term-accepted', cwd: reusedWorktree, agentId: 'codex' }]
    const state = baseState(projectRoot, [
      task(projectRoot, 'QF-A', {
        status: 'accepted',
        worker: {
          agentId: 'codex',
          terminalHandle: 'term-accepted',
          worktreePath: reusedWorktree
        },
        worktree: { path: projectRoot }
      }),
      task(projectRoot, 'QF-B', {
        status: 'planned',
        dependsOn: ['QF-A'],
        worker: { agentId: 'codex', reuseFromTaskId: 'QF-A' },
        permittedScope: ['docs/follow-up.md']
      })
    ])

    await run(projectRoot, state, orca, 2)

    expect(orca.dispatches).toHaveLength(1)
    expect(orca.dispatches[0].terminalHandle).toBe('term-accepted')
    expect(orca.calls.some((call) => call.name === 'worktreeCreate')).toBe(false)
    expect(state.tasks[1].worker.reusedFromTaskId).toBe('QF-A')
    expect(path.resolve(state.tasks[1].attempts[0].workerWorktreePath)).toBe(
      path.resolve(reusedWorktree)
    )
    expect(JSON.parse(orca.tasks[0].spec).repository.worktree).toBe(reusedWorktree)
  })

  it('records rate-limit backoff without creating duplicate dispatches', async () => {
    const projectRoot = makeProject()
    const orca = new FakeOrca(projectRoot)
    const state = baseState(projectRoot, [task(projectRoot, 'QF-A'), task(projectRoot, 'QF-B')], {
      maxConcurrentWorkers: 2,
      rateLimitBackoffMs: 10_000
    })

    await run(projectRoot, state, orca, 1)
    orca.queue.push({
      messages: [
        {
          id: 'rate-limit',
          type: 'escalation',
          subject: 'rate limited',
          body: 'Codex account throttling, please back off.',
          payload: { taskId: 'task_1', dispatchId: 'ctx_1' }
        }
      ]
    })
    await run(projectRoot, state, orca, 1)

    expect(orca.dispatches).toHaveLength(2)
    expect(state.settings.effectiveMaxConcurrentWorkers).toBe(1)
    expect(state.tasks[0].rateLimitBackoffUntil).toBeTruthy()
    expect(state.lifecycleEvents.map((event) => event.result)).toContain(
      'rate_limit_backoff_recorded'
    )
  })
})
