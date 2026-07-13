import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

function makeTempProject() {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'qfoundry-profile-'))
  tempDirs.push(projectRoot)
  mkdirSync(path.join(projectRoot, '.qfoundry', 'reports'), { recursive: true })
  writeFileSync(path.join(projectRoot, '.qfoundry', 'PROJECT_CONTRACT.md'), '# Contract\n', 'utf8')
  runGit(projectRoot, ['init'])
  runGit(projectRoot, ['config', 'user.email', 'qfoundry@example.test'])
  runGit(projectRoot, ['config', 'user.name', 'qFoundry Test'])
  runGit(projectRoot, ['add', '.qfoundry/PROJECT_CONTRACT.md'])
  runGit(projectRoot, ['commit', '-m', 'Initial qFoundry contract'])
  return projectRoot
}

function approvedState(projectRoot, taskExtra = {}) {
  const { worker: workerExtra = {}, ...restTaskExtra } = taskExtra
  return {
    schemaVersion: 1,
    projectName: 'qFoundry Worker Profile Test',
    contract: {
      path: '.qfoundry/PROJECT_CONTRACT.md',
      status: 'approved',
      approval: {
        attributedTo: 'user',
        decisionRecordId: 'DEC-001',
        approvalGateResolved: true
      }
    },
    settings: { waitTimeoutMs: 900_000, maxCorrectionRounds: 1 },
    processedMessages: [],
    lifecycleEvents: [],
    checkpoints: [],
    tasks: [
      {
        id: 'QF-PROFILE-001',
        title: 'Profile worker',
        objective: 'Launch profiled worker.',
        status: 'ready',
        requirements: ['REQ-001'],
        acceptanceCriteria: ['AC-001'],
        verificationCommands: [],
        reportPath: '.qfoundry/reports/worker.md',
        worktree: {},
        worker: {
          agentId: 'qfoundry-codex-worker',
          create: true,
          worktreeName: 'qf-profiled-worker',
          ...workerExtra
        },
        ...restTaskExtra
      }
    ]
  }
}

class FakeOrca {
  constructor(projectRoot) {
    this.projectRoot = projectRoot
    this.calls = []
    this.terminals = []
    this.tasks = []
    this.dispatches = []
  }

  async terminalList() {
    return { terminals: this.terminals }
  }

  async terminalWait(handle) {
    this.calls.push({ name: 'terminalWait', handle })
    return { handle, ready: true }
  }

  async worktreeCreate({ name, repo }) {
    const worktreePath = path.join(this.projectRoot, name)
    mkdirSync(worktreePath, { recursive: true })
    runGit(worktreePath, ['init'])
    runGit(worktreePath, ['config', 'user.email', 'qfoundry@example.test'])
    runGit(worktreePath, ['config', 'user.name', 'qFoundry Test'])
    writeFileSync(path.join(worktreePath, 'README.md'), '# Worker\n', 'utf8')
    runGit(worktreePath, ['add', 'README.md'])
    runGit(worktreePath, ['commit', '-m', 'Initial worker'])
    this.calls.push({ name: 'worktreeCreate', worktreeName: name, repo, worktreePath })
    return { id: `worktree-${name}`, path: worktreePath }
  }

  async terminalCreate({ worktree, title, command }) {
    const handle = `term-${this.calls.length}`
    this.calls.push({ name: 'terminalCreate', worktree, title, command, handle })
    this.terminals.push({ handle, cwd: worktree, agentId: 'codex' })
    return { terminal: { handle } }
  }

  async taskCreate(spec) {
    const taskId = `task_${this.tasks.length + 1}`
    this.tasks.push({ id: taskId, spec })
    return { taskId }
  }

  async taskList() {
    return { tasks: this.tasks }
  }

  async dispatch(taskId, terminalHandle) {
    const dispatchId = `ctx_${this.dispatches.length + 1}`
    this.dispatches.push({ taskId, terminalHandle, dispatchId })
    return { dispatchId }
  }

  async dispatchShow(taskId) {
    return { dispatches: this.dispatches.filter((dispatch) => dispatch.taskId === taskId) }
  }
}

class ConstantReviewer {
  async review() {
    return {
      verdict: 'accepted',
      summary: 'accepted',
      failedRequirements: [],
      failedAcceptanceCriteria: [],
      testsRun: [],
      evidence: ['accepted by worker profile test']
    }
  }
}

function makeCodexHelpMock(projectRoot) {
  const filePath = path.join(projectRoot, 'codex-mock.mjs')
  writeFileSync(filePath, 'console.log("--profile --cd --sandbox --ask-for-approval")\n', 'utf8')
  return { command: process.execPath, args: [filePath] }
}

async function runProfileTask(projectRoot, state, orca) {
  const controller = new QFoundryController({
    projectRoot,
    state,
    orca,
    reviewer: new ConstantReviewer(),
    statePath: '.qfoundry/controller-state.json'
  })
  await controller.run({ maxSteps: 1 })
  return state.tasks[0]
}

async function withCodexHome(codexHome, callback) {
  const oldCodexHome = process.env.CODEX_HOME
  process.env.CODEX_HOME = codexHome
  try {
    return await callback()
  } finally {
    if (oldCodexHome) {
      process.env.CODEX_HOME = oldCodexHome
    } else {
      delete process.env.CODEX_HOME
    }
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true })
  }
})

describe('qFoundry Codex worker profiles', () => {
  it('launches a requested qfoundry-codex-worker with a generated scoped profile', async () => {
    const projectRoot = makeTempProject()
    const codexMock = makeCodexHelpMock(projectRoot)
    const orca = new FakeOrca(projectRoot)
    const state = approvedState(projectRoot, {
      worker: { codexCommand: codexMock.command, codexCommandArgs: codexMock.args }
    })

    const task = await runProfileTask(projectRoot, state, orca)
    const terminalCreate = orca.calls.find((call) => call.name === 'terminalCreate')

    expect(terminalCreate.command).toContain('--profile')
    expect(terminalCreate.command).toContain('qfoundry-worker')
    expect(readFileSync(task.worker.profileEvidence.profilePath, 'utf8')).toContain(
      projectRoot.replaceAll('\\', '/')
    )
    expect(readFileSync(task.worker.profileEvidence.profilePath, 'utf8')).toContain(
      `[projects.${JSON.stringify(path.resolve(projectRoot))}]`
    )
    expect(task.worker.profileEvidence.trustedProjectRoots).toContain(path.resolve(projectRoot))
  })

  it('records first-class windows-codex-compat profile evidence', async () => {
    const projectRoot = makeTempProject()
    const codexMock = makeCodexHelpMock(projectRoot)
    const authHome = path.join(projectRoot, '.codex-auth-home')
    const orca = new FakeOrca(projectRoot)
    const state = approvedState(projectRoot, {
      worker: {
        codexCommand: codexMock.command,
        codexCommandArgs: codexMock.args,
        profileMode: 'windows-codex-compat'
      }
    })

    const task = await withCodexHome(authHome, () => runProfileTask(projectRoot, state, orca))
    const evidence = task.worker.profileEvidence

    expect(evidence.profileMode).toBe('windows-codex-compat')
    expect(evidence.codexHome).toBe(authHome)
    expect(evidence.preflight).toEqual(
      expect.objectContaining({
        mode: 'windows-codex-compat',
        workspaceWriteSandbox: true,
        approvalPolicy: 'on-request',
        automaticBoundaryReview: true,
        networkDisabled: true,
        authenticatedCodexHomeUsed: true,
        dangerousBypassFlagsAbsent: true,
        filesystemGranularity: 'workspace-write compatibility'
      })
    )
    expect(evidence.preflight.sensitiveEnvironmentExclusions).toContain('GITHUB_*')
  })

  it('can place the generated worker profile in an authenticated Codex home by opt-in', async () => {
    const projectRoot = makeTempProject()
    const codexMock = makeCodexHelpMock(projectRoot)
    const authHome = path.join(projectRoot, '.codex-auth-home')
    const orca = new FakeOrca(projectRoot)
    const state = approvedState(projectRoot, {
      worker: {
        codexCommand: codexMock.command,
        codexCommandArgs: codexMock.args,
        useAuthenticatedCodexHome: true
      }
    })

    const task = await withCodexHome(authHome, () => runProfileTask(projectRoot, state, orca))

    expect(task.worker.profileEvidence.profilePath).toBe(
      path.join(authHome, 'qfoundry-worker.config.toml')
    )
    expect(task.worker.profileEvidence.authBoundary).toContain('existing authenticated Codex home')
  })
})
