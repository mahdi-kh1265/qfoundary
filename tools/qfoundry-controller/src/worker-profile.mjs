import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { resolveQFoundryPath } from './path-policy.mjs'
import { runProcess } from './process-runner.mjs'

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex')
}

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function shQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function codexCommandFromEnv() {
  return process.env.QFOUNDRY_CODEX_CLI ?? process.env.CODEX_CLI_PATH ?? 'codex'
}

export function buildWorkerLaunchCommand({
  codexCommand,
  codexCommandArgs = [],
  profileName,
  worktreePath,
  codexHome
}) {
  if (process.platform === 'win32') {
    const extraArgs = codexCommandArgs.map((arg) => psQuote(arg)).join(' ')
    return [
      `$env:CODEX_HOME=${psQuote(codexHome)}`,
      `& ${psQuote(codexCommand)} ${extraArgs} --profile ${psQuote(profileName)} -C ${psQuote(worktreePath)}`
    ].join('; ')
  }
  return [
    `CODEX_HOME=${shQuote(codexHome)}`,
    shQuote(codexCommand),
    ...codexCommandArgs.map((arg) => shQuote(arg)),
    '--profile',
    shQuote(profileName),
    '-C',
    shQuote(worktreePath)
  ].join(' ')
}

export async function prepareCodexWorkerProfile({
  controllerRoot,
  projectRoot,
  state,
  task,
  worktreePath,
  now
}) {
  if (!worktreePath) {
    throw new Error(`cannot launch qFoundry Codex worker without a worktree path for ${task.id}`)
  }
  const profileName = task.worker.profileName ?? 'qfoundry-worker'
  const codexCommand = task.worker.codexCommand ?? codexCommandFromEnv()
  const codexCommandArgs = task.worker.codexCommandArgs ?? []
  const profileHome = resolveQFoundryPath(
    projectRoot,
    task.worker.codexHome ?? path.join('.qfoundry', 'codex-worker-home'),
    'Codex worker profile home'
  )
  await mkdir(profileHome, { recursive: true })
  const templatePath =
    task.worker.profileTemplatePath ??
    path.join(controllerRoot, 'profiles', 'codex-worker.permissions.config.toml')
  const template = await readFile(templatePath, 'utf8')
  const normalizedWorktree = path.resolve(worktreePath).replaceAll('\\', '/')
  const profileText = template.replaceAll('/ABSOLUTE/PATH/TO/ASSIGNED/WORKTREE', normalizedWorktree)
  const profilePath = path.join(profileHome, `${profileName}.config.toml`)
  await writeFile(profilePath, profileText, 'utf8')
  const help = await runProcess({
    command: codexCommand,
    args: [...codexCommandArgs, '--help'],
    cwd: worktreePath,
    timeoutMs: state.settings.workerProfilePreflightTimeoutMs ?? 15_000,
    maxStdoutBytes: 64_000,
    maxStderrBytes: 64_000
  })
  if (help.timedOut || help.exitCode !== 0) {
    throw new Error(`Codex worker preflight failed: ${help.stderr || help.stdout}`)
  }
  for (const required of ['--profile', '--cd']) {
    if (!help.stdout.includes(required)) {
      throw new Error(`installed Codex CLI does not advertise required ${required} support`)
    }
  }
  const launchCommand = buildWorkerLaunchCommand({
    codexCommand,
    codexCommandArgs,
    profileName,
    worktreePath,
    codexHome: profileHome
  })
  if (/dangerously-bypass-approvals-and-sandbox|danger-full-access/i.test(launchCommand)) {
    throw new Error('qFoundry worker launch command must not bypass approvals or sandboxing')
  }
  return {
    profileName,
    codexCommand,
    codexCommandArgs,
    codexHome: profileHome,
    profilePath,
    profileSha256: sha256Text(profileText),
    worktreePath: path.resolve(worktreePath),
    launchCommand,
    preflight: {
      checkedAt: now().toISOString(),
      supportsProfile: help.stdout.includes('--profile'),
      supportsCd: help.stdout.includes('--cd'),
      supportsSandbox: help.stdout.includes('--sandbox'),
      supportsAskForApproval: help.stdout.includes('--ask-for-approval')
    }
  }
}
