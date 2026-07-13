import { runProcess } from './process-runner.mjs'

function getPathValue(record, keyPath) {
  return keyPath.split('.').reduce((value, key) => {
    if (value && typeof value === 'object') {
      return value[key]
    }
    return undefined
  }, record)
}

function firstString(record, keyPaths) {
  for (const keyPath of keyPaths) {
    const value = getPathValue(record, keyPath)
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }
  return undefined
}

export function parseJsonOutput(stdout, commandLine) {
  try {
    return JSON.parse(stdout)
  } catch (error) {
    throw new Error(`expected JSON from ${commandLine}: ${error.message}\n${stdout}`)
  }
}

export class OrcaJsonCli {
  constructor({
    command = 'orca',
    commandArgs = [],
    fromTerminal,
    cwd = process.cwd(),
    env = process.env,
    timeoutMs = 60_000,
    maxOutputBytes = 128_000
  } = {}) {
    this.command = command
    this.commandArgs = commandArgs
    this.fromTerminal = fromTerminal
    this.cwd = cwd
    this.env = env
    this.timeoutMs = timeoutMs
    this.maxOutputBytes = maxOutputBytes
  }

  async runJson(args, options = {}) {
    const allArgs = [...this.commandArgs, ...args]
    const commandLine = `${this.command} ${allArgs.join(' ')}`
    const result = await runProcess({
      command: this.command,
      args: allArgs,
      cwd: options.cwd ?? this.cwd,
      env: options.env ?? this.env,
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      maxStdoutBytes: options.maxOutputBytes ?? this.maxOutputBytes,
      maxStderrBytes: options.maxOutputBytes ?? this.maxOutputBytes
    })
    if (result.timedOut) {
      const error = new Error(
        `${commandLine} timed out after ${options.timeoutMs ?? this.timeoutMs}ms`
      )
      error.stdout = result.stdout
      error.stderr = result.stderr
      error.timedOut = true
      throw error
    }
    if (result.exitCode !== 0) {
      const error = new Error(
        `${commandLine} exited ${result.exitCode}: ${result.stderr || result.stdout}`
      )
      error.stdout = result.stdout
      error.stderr = result.stderr
      error.code = result.exitCode
      throw error
    }
    return parseJsonOutput(result.stdout, commandLine)
  }

  async status() {
    return await this.runJson(['status', '--json'])
  }

  async taskCreate(spec) {
    const result = await this.runJson(['orchestration', 'task-create', '--spec', spec, '--json'])
    return {
      raw: result,
      taskId: firstString(result, ['result.task.id', 'task.id', 'task.taskId', 'taskId', 'id'])
    }
  }

  async taskList() {
    return await this.runJson(['orchestration', 'task-list', '--json'])
  }

  async terminalList() {
    return await this.runJson(['terminal', 'list', '--json'])
  }

  async worktreeCreate({ name, agentId, repo, noParent = true }) {
    const args = ['worktree', 'create', '--name', name]
    if (repo) {
      args.push('--repo', repo)
    }
    if (noParent) {
      args.push('--no-parent')
    }
    if (agentId) {
      args.push('--agent', agentId)
    }
    args.push('--json')
    const result = await this.runJson(args)
    return result.result ?? result
  }

  async terminalCreate({ worktree, title, command }) {
    const result = await this.runJson([
      'terminal',
      'create',
      '--worktree',
      worktree,
      '--title',
      title,
      '--command',
      command,
      '--json'
    ])
    return result.result ?? result
  }

  async terminalWait(handle, timeoutMs = 60_000) {
    return await this.runJson([
      'terminal',
      'wait',
      '--terminal',
      handle,
      '--for',
      'tui-idle',
      '--timeout-ms',
      String(timeoutMs),
      '--json'
    ])
  }

  async terminalSendEnter(handle) {
    return await this.runJson(['terminal', 'send', '--terminal', handle, '--enter', '--json'])
  }

  async dispatch(taskId, terminalHandle) {
    const args = ['orchestration', 'dispatch', '--task', taskId, '--to', terminalHandle]
    if (this.fromTerminal) {
      args.push('--from', this.fromTerminal)
    }
    args.push('--inject', '--json')
    const result = await this.runJson(args)
    return {
      raw: result,
      dispatchId: firstString(result, [
        'result.dispatch.id',
        'result.dispatch.dispatchId',
        'result.dispatchId',
        'result.context.dispatchId',
        'result.context.id',
        'dispatch.id',
        'dispatch.dispatchId',
        'dispatchId',
        'context.dispatchId',
        'context.id',
        'id'
      ])
    }
  }

  async dispatchShow(taskId) {
    return await this.runJson(['orchestration', 'dispatch-show', '--task', taskId, '--json'])
  }

  async checkWait(timeoutMs) {
    const args = [
      'orchestration',
      'check',
      '--wait',
      '--types',
      'worker_done,escalation,decision_gate',
      '--timeout-ms',
      String(timeoutMs)
    ]
    if (this.fromTerminal) {
      args.push('--terminal', this.fromTerminal)
    }
    args.push('--json')
    return await this.runJson(args, { timeoutMs: timeoutMs + 30_000 })
  }

  async reply(messageId, body) {
    const args = ['orchestration', 'reply', '--id', messageId, '--body', body]
    if (this.fromTerminal) {
      args.push('--from', this.fromTerminal)
    }
    args.push('--json')
    return await this.runJson(args)
  }
}

export function extractMessages(result) {
  if (Array.isArray(result)) {
    return result
  }
  if (result.result) {
    return extractMessages(result.result)
  }
  if (Array.isArray(result.messages)) {
    return result.messages
  }
  if (Array.isArray(result.items)) {
    return result.items
  }
  if (result.message && typeof result.message === 'object') {
    return [result.message]
  }
  return []
}

export function extractStartupTerminal(result) {
  if (result?.result) {
    return extractStartupTerminal(result.result)
  }
  return (
    result.startupTerminal ??
    result.worktree?.startupTerminal ??
    result.terminal ??
    result.createdTerminal ??
    null
  )
}
