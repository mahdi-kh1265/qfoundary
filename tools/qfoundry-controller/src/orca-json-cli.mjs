import { spawn } from 'node:child_process'

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
  constructor({ command = 'orca', cwd = process.cwd(), env = process.env } = {}) {
    this.command = command
    this.cwd = cwd
    this.env = env
  }

  async runJson(args, options = {}) {
    const commandLine = `${this.command} ${args.join(' ')}`
    return await new Promise((resolve, reject) => {
      const child = spawn(this.command, args, {
        cwd: options.cwd ?? this.cwd,
        env: options.env ?? this.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) {
          resolve(parseJsonOutput(stdout, commandLine))
          return
        }
        const error = new Error(`${commandLine} exited ${code}: ${stderr || stdout}`)
        error.stdout = stdout
        error.stderr = stderr
        error.code = code
        reject(error)
      })
    })
  }

  async status() {
    return await this.runJson(['status', '--json'])
  }

  async taskCreate(spec) {
    const result = await this.runJson(['orchestration', 'task-create', '--spec', spec, '--json'])
    return {
      raw: result,
      taskId: firstString(result, ['task.id', 'task.taskId', 'taskId', 'id'])
    }
  }

  async taskList() {
    return await this.runJson(['orchestration', 'task-list', '--json'])
  }

  async terminalList() {
    return await this.runJson(['terminal', 'list', '--json'])
  }

  async worktreeCreate({ name, agentId }) {
    return await this.runJson([
      'worktree',
      'create',
      '--name',
      name,
      '--no-parent',
      '--agent',
      agentId,
      '--json'
    ])
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

  async dispatch(taskId, terminalHandle) {
    const result = await this.runJson([
      'orchestration',
      'dispatch',
      '--task',
      taskId,
      '--to',
      terminalHandle,
      '--inject',
      '--json'
    ])
    return {
      raw: result,
      dispatchId: firstString(result, [
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
    return await this.runJson([
      'orchestration',
      'check',
      '--wait',
      '--types',
      'worker_done,escalation,decision_gate',
      '--timeout-ms',
      String(timeoutMs),
      '--json'
    ])
  }

  async reply(messageId, body) {
    return await this.runJson([
      'orchestration',
      'reply',
      '--id',
      messageId,
      '--body',
      body,
      '--json'
    ])
  }
}

export function extractMessages(result) {
  if (Array.isArray(result)) {
    return result
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
  return (
    result.startupTerminal ??
    result.worktree?.startupTerminal ??
    result.terminal ??
    result.createdTerminal ??
    null
  )
}
