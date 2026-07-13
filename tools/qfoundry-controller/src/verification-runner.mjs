import path from 'node:path'

import { resolveWorktreeCwd } from './path-policy.mjs'
import { runProcess } from './process-runner.mjs'

const DEFAULT_VERIFY_TIMEOUT_MS = 60_000
const DEFAULT_VERIFY_OUTPUT_BYTES = 64_000

function expectedExit(command) {
  return command.expectedExitCode ?? command.expectedExit ?? 0
}

function currentAttempt(task) {
  return task.currentAttemptId
    ? task.attempts?.find((candidate) => candidate.id === task.currentAttemptId)
    : task.attempts?.at(-1)
}

export async function runVerificationCommands({
  task,
  timeoutMs = DEFAULT_VERIFY_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_VERIFY_OUTPUT_BYTES
}) {
  const commands = task.verificationCommands ?? []
  const attempt = currentAttempt(task)
  if (!attempt?.id || attempt.dispatchId !== task.dispatchId) {
    return {
      ok: false,
      taskId: task.id,
      dispatchId: task.dispatchId,
      attemptId: attempt?.id ?? null,
      failures: ['verification cannot be attributed to the current task attempt'],
      results: [],
      ranAt: new Date().toISOString()
    }
  }
  if (!Array.isArray(commands) || commands.length === 0) {
    return {
      ok: false,
      taskId: task.id,
      dispatchId: task.dispatchId,
      attemptId: attempt.id,
      failures: ['task has no structured verificationCommands'],
      results: [],
      ranAt: new Date().toISOString()
    }
  }
  const worktreeRoot = attempt.dispatchBaseline?.repositoryRoot ?? attempt.repositoryRoot
  if (!worktreeRoot) {
    return {
      ok: false,
      taskId: task.id,
      dispatchId: task.dispatchId,
      attemptId: attempt.id,
      failures: ['verification cannot determine worker repository root'],
      results: [],
      ranAt: new Date().toISOString()
    }
  }

  const failures = []
  const results = []
  for (const [index, commandSpec] of commands.entries()) {
    if (!commandSpec || typeof commandSpec.command !== 'string') {
      failures.push(`verification command ${index + 1} is missing a command string`)
      continue
    }
    if (
      !Array.isArray(commandSpec.args) ||
      commandSpec.args.some((arg) => typeof arg !== 'string')
    ) {
      failures.push(`verification command ${index + 1} args must be an array of strings`)
      continue
    }
    const cwd = resolveWorktreeCwd(worktreeRoot, commandSpec.cwd ?? '.')
    const commandTimeoutMs = commandSpec.timeoutMs ?? timeoutMs
    const result = await runProcess({
      command: commandSpec.command,
      args: commandSpec.args,
      cwd,
      timeoutMs: commandTimeoutMs,
      maxStdoutBytes: commandSpec.maxOutputBytes ?? maxOutputBytes,
      maxStderrBytes: commandSpec.maxOutputBytes ?? maxOutputBytes
    })
    const expectedExitCode = expectedExit(commandSpec)
    const outputPattern =
      typeof commandSpec.expectedOutputPattern === 'string'
        ? new RegExp(commandSpec.expectedOutputPattern)
        : null
    const combinedOutput = `${result.stdout}\n${result.stderr}`
    const outputMatches = outputPattern ? outputPattern.test(combinedOutput) : true
    const ok = !result.timedOut && result.exitCode === expectedExitCode && outputMatches
    if (!ok) {
      if (result.timedOut) {
        failures.push(`verification command ${index + 1} timed out`)
      } else if (result.exitCode !== expectedExitCode) {
        failures.push(
          `verification command ${index + 1} exited ${result.exitCode}, expected ${expectedExitCode}`
        )
      } else {
        failures.push(`verification command ${index + 1} did not match expected output pattern`)
      }
    }
    results.push({
      taskId: task.id,
      orcaTaskId: task.orcaTaskId,
      dispatchId: task.dispatchId,
      attemptId: attempt.id,
      index,
      command: result.command,
      args: result.args,
      cwd: path.resolve(cwd),
      exitCode: result.exitCode,
      expectedExitCode,
      timedOut: result.timedOut,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
      durationMs: result.durationMs,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      expectedOutputPattern: commandSpec.expectedOutputPattern ?? null,
      outputMatches,
      ok
    })
  }

  return {
    ok: failures.length === 0 && results.length === commands.length,
    taskId: task.id,
    dispatchId: task.dispatchId,
    attemptId: attempt.id,
    failures,
    results,
    ranAt: new Date().toISOString()
  }
}
