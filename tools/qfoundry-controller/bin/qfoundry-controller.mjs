#!/usr/bin/env node
import process from 'node:process'

import { QFoundryController } from '../src/controller.mjs'
import { OrcaJsonCli } from '../src/orca-json-cli.mjs'
import { CommandReviewer } from '../src/reviewer.mjs'
import { DEFAULT_STATE_PATH, loadControllerState } from '../src/state-store.mjs'

function argValue(args, name, fallback = undefined) {
  const prefix = `--${name}=`
  const inline = args.find((arg) => arg.startsWith(prefix))
  if (inline) {
    return inline.slice(prefix.length)
  }
  const index = args.indexOf(`--${name}`)
  if (index !== -1) {
    return args[index + 1] ?? fallback
  }
  return fallback
}

function hasFlag(args, name) {
  return args.includes(`--${name}`)
}

function parsePositiveInteger(args, name, fallback) {
  const raw = argValue(args, name)
  if (raw === undefined) {
    return fallback
  }
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${name} must be a positive integer`)
  }
  return value
}

function usage() {
  return `Usage:
  node tools/qfoundry-controller/bin/qfoundry-controller.mjs run --project <path> [options]
  node tools/qfoundry-controller/bin/qfoundry-controller.mjs resume --project <path> [options]
  node tools/qfoundry-controller/bin/qfoundry-controller.mjs status --project <path> [options]
  node tools/qfoundry-controller/bin/qfoundry-controller.mjs decisions --project <path> [options]
  node tools/qfoundry-controller/bin/qfoundry-controller.mjs answer --project <path> --decision <id> --answer <value> [options]

Options:
  --state <path>              State path relative to project root (default .qfoundry/controller-state.json)
  --orca <command>            Orca CLI command or absolute path (default orca)
  --review-command <command>  Command that reads review JSON input on stdin and prints strict review JSON
  --review-arg <arg>          Extra review command argument; repeatable
  --review-timeout-ms <n>     Review command timeout (default 120000)
  --orca-timeout-ms <n>       Orca CLI subprocess timeout (default 60000)
  --wait-timeout-ms <n>       Bounded rolling wait interval (default from state or 900000)
  --max-correction-rounds <n> Automatic correction limit (default from state or 3)
  --max-steps <n>             Controller loop step cap for this invocation (default 100)
  --once                     Alias for --max-steps 1
`
}

function repeatedArgs(args, name) {
  const values = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === `--${name}` && args[index + 1]) {
      values.push(args[index + 1])
    }
  }
  return values
}

async function loadConfiguredController(args, projectRoot, statePath) {
  const state = await loadControllerState(projectRoot, statePath)
  state.settings.waitTimeoutMs = parsePositiveInteger(
    args,
    'wait-timeout-ms',
    state.settings.waitTimeoutMs
  )
  state.settings.maxCorrectionRounds = parsePositiveInteger(
    args,
    'max-correction-rounds',
    state.settings.maxCorrectionRounds
  )
  const reviewCommand = argValue(args, 'review-command')
  return new QFoundryController({
    projectRoot,
    statePath,
    state,
    orca: new OrcaJsonCli({
      command: argValue(args, 'orca', 'orca'),
      cwd: projectRoot,
      timeoutMs: parsePositiveInteger(args, 'orca-timeout-ms', 60_000)
    }),
    reviewer: new CommandReviewer({
      command: reviewCommand,
      args: repeatedArgs(args, 'review-arg'),
      timeoutMs: parsePositiveInteger(args, 'review-timeout-ms', 120_000)
    }),
    logger: (message) => process.stderr.write(`${message}\n`)
  })
}

function statusSummary(state) {
  return {
    projectName: state.projectName,
    tasks: state.tasks.map((task) => ({
      id: task.id,
      status: task.status,
      orcaTaskId: task.orcaTaskId ?? null,
      dispatchId: task.dispatchId ?? null,
      currentAttemptId: task.currentAttemptId ?? null,
      workerTerminalHandle: task.worker?.terminalHandle ?? null,
      reviewReportPath: task.reviewReportPath ?? null
    })),
    pendingDecisions: (state.pendingDecisions ?? []).filter(
      (decision) => decision.status === 'pending'
    ),
    checkpoints: state.checkpoints
  }
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]
  if (hasFlag(args, 'help') || hasFlag(args, 'h')) {
    process.stdout.write(usage())
    process.exit(0)
  }
  if (!['run', 'resume', 'status', 'decisions', 'answer'].includes(command)) {
    process.stdout.write(usage())
    process.exit(1)
  }
  const projectRoot = argValue(args, 'project')
  if (!projectRoot) {
    throw new Error('--project is required')
  }
  const statePath = argValue(args, 'state', DEFAULT_STATE_PATH)
  const controller = await loadConfiguredController(args, projectRoot, statePath)
  if (command === 'status') {
    process.stdout.write(`${JSON.stringify(statusSummary(controller.state), null, 2)}\n`)
    return
  }
  if (command === 'decisions') {
    process.stdout.write(`${JSON.stringify(controller.state.pendingDecisions ?? [], null, 2)}\n`)
    return
  }
  if (command === 'answer') {
    const decisionId = argValue(args, 'decision')
    const answer = argValue(args, 'answer')
    if (!decisionId || answer === undefined) {
      throw new Error('--decision and --answer are required')
    }
    const decision = await controller.answerDecision(decisionId, answer)
    const maxSteps = parsePositiveInteger(args, 'max-steps', 1)
    const result = await controller.run({ maxSteps })
    process.stdout.write(
      `${JSON.stringify({ ok: true, decision, resumedSteps: result.steps }, null, 2)}\n`
    )
    return
  }
  const maxSteps = hasFlag(args, 'once') ? 1 : parsePositiveInteger(args, 'max-steps', 100)
  const result = await controller.run({ maxSteps })
  process.stdout.write(`${JSON.stringify({ ok: true, steps: result.steps }, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`)
  process.exit(1)
})
