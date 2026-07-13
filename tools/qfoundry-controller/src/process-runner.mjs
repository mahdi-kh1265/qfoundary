import { spawn } from 'node:child_process'
import process from 'node:process'

const DEFAULT_MAX_OUTPUT_BYTES = 64_000
const DEFAULT_TIMEOUT_MS = 60_000

function appendBounded(current, chunk, maxBytes) {
  const next = `${current}${chunk}`
  const buffer = Buffer.from(next, 'utf8')
  if (buffer.byteLength <= maxBytes) {
    return { text: next, truncated: false }
  }
  return {
    text: buffer.subarray(0, maxBytes).toString('utf8'),
    truncated: true
  }
}

function terminateProcessTree(child) {
  if (!child.pid || child.exitCode !== null) {
    return
  }
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    })
    killer.on('error', () => {})
    child.kill()
    return
  }
  child.kill('SIGTERM')
  setTimeout(() => {
    if (child.exitCode === null) {
      child.kill('SIGKILL')
    }
  }, 1_000).unref()
}

export function quoteCommandForDisplay(command, args = []) {
  return [command, ...args].map((part) => JSON.stringify(String(part))).join(' ')
}

export function runProcess({
  command,
  args = [],
  cwd = process.cwd(),
  env = process.env,
  stdin = '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxStdoutBytes = DEFAULT_MAX_OUTPUT_BYTES,
  maxStderrBytes = DEFAULT_MAX_OUTPUT_BYTES
}) {
  if (!command || typeof command !== 'string') {
    throw new Error('process command must be a non-empty string')
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new Error('process args must be an array of strings')
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('process timeoutMs must be a positive integer')
  }

  const startedAt = new Date()
  const startNanos = process.hrtime.bigint()
  const commandLine = quoteCommandForDisplay(command, args)

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''
    let stdoutTruncated = false
    let stderrTruncated = false
    let timedOut = false
    let settled = false

    const timeout = setTimeout(() => {
      timedOut = true
      terminateProcessTree(child)
    }, timeoutMs)
    timeout.unref()

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk) => {
      const next = appendBounded(stdout, chunk, maxStdoutBytes)
      stdout = next.text
      stdoutTruncated ||= next.truncated
    })

    child.stderr.on('data', (chunk) => {
      const next = appendBounded(stderr, chunk, maxStderrBytes)
      stderr = next.text
      stderrTruncated ||= next.truncated
    })

    child.on('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      error.commandLine = commandLine
      reject(error)
    })

    child.on('close', (exitCode, signal) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      const finishedAt = new Date()
      const durationMs = Number((process.hrtime.bigint() - startNanos) / 1_000_000n)
      resolve({
        command,
        args,
        commandLine,
        cwd,
        exitCode,
        signal,
        timedOut,
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
        durationMs,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString()
      })
    })

    child.stdin.on('error', () => {})
    child.stdin.end(stdin)
  })
}
