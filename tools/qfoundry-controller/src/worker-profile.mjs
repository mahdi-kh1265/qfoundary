import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
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

function tomlString(value) {
  return JSON.stringify(String(value))
}

function uniqueResolvedPaths(paths) {
  return [...new Set(paths.filter(Boolean).map((item) => path.resolve(item)))]
}

function trustedProjectTables(paths) {
  return uniqueResolvedPaths(paths)
    .map((projectPath) =>
      [`[projects.${tomlString(projectPath)}]`, 'trust_level = "trusted"'].join('\n')
    )
    .join('\n\n')
}

function codexCommandFromEnv() {
  return process.env.QFOUNDRY_CODEX_CLI ?? process.env.CODEX_CLI_PATH ?? 'codex'
}

function profileMode(worker) {
  return worker.profileMode ?? worker.mode ?? 'codex-permissions'
}

function usesAuthenticatedCodexHome(worker, mode) {
  return worker.useAuthenticatedCodexHome ?? mode === 'windows-codex-compat'
}

function resolveProfileHome(projectRoot, worker, mode) {
  if (usesAuthenticatedCodexHome(worker, mode)) {
    return path.resolve(process.env.CODEX_HOME ?? path.join(homedir(), '.codex'))
  }
  return resolveQFoundryPath(
    projectRoot,
    worker.codexHome ?? path.join('.qfoundry', 'codex-worker-home'),
    'Codex worker profile home'
  )
}

function templatePathForMode(controllerRoot, worker, mode) {
  if (worker.profileTemplatePath) {
    return worker.profileTemplatePath
  }
  if (mode === 'windows-codex-compat') {
    return path.join(controllerRoot, 'profiles', 'codex-worker.compat.config.toml')
  }
  if (mode === 'codex-permissions') {
    return path.join(controllerRoot, 'profiles', 'codex-worker.permissions.config.toml')
  }
  throw new Error(`unknown qFoundry Codex worker profile mode: ${mode}`)
}

function profilePreflightEvidence({
  mode,
  profileText,
  worktreePath,
  codexHome,
  authenticatedHome
}) {
  const dangerousBypassFlagsAbsent =
    !/dangerously-bypass-approvals-and-sandbox|danger-full-access|yolo/i.test(profileText)
  return {
    mode,
    workspaceWriteSandbox: /sandbox_mode\s*=\s*"workspace-write"/.test(profileText),
    approvalPolicy:
      profileText.match(/approval_policy\s*=\s*"([^"]+)"/)?.[1] ??
      (profileText.includes('default_permissions') ? 'permission-profile' : 'unknown'),
    automaticBoundaryReview: /approvals_reviewer\s*=\s*"auto_review"/.test(profileText),
    networkDisabled:
      /network_access\s*=\s*false/.test(profileText) || /enabled\s*=\s*false/.test(profileText),
    effectiveWorktreeDirectory: path.resolve(worktreePath),
    authenticatedCodexHomeUsed: authenticatedHome,
    codexHome,
    sensitiveEnvironmentExclusions: [
      '*KEY*',
      '*SECRET*',
      '*TOKEN*',
      '*PASSWORD*',
      'GITHUB_*',
      'AWS_*',
      'AZURE_*'
    ],
    dangerousBypassFlagsAbsent,
    filesystemGranularity:
      mode === 'windows-codex-compat' ? 'workspace-write compatibility' : 'permission profile'
  }
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
  const mode = profileMode(task.worker)
  const codexCommand = task.worker.codexCommand ?? codexCommandFromEnv()
  const codexCommandArgs = task.worker.codexCommandArgs ?? []
  const profileHome = resolveProfileHome(projectRoot, task.worker, mode)
  await mkdir(profileHome, { recursive: true })
  const templatePath = templatePathForMode(controllerRoot, task.worker, mode)
  const template = await readFile(templatePath, 'utf8')
  const normalizedWorktree = path.resolve(worktreePath).replaceAll('\\', '/')
  const trustedProjectRoots = uniqueResolvedPaths([projectRoot, worktreePath])
  const profileText = [
    template.replaceAll('/ABSOLUTE/PATH/TO/ASSIGNED/WORKTREE', normalizedWorktree).trimEnd(),
    '# qFoundry trusts only the assigned repository/worktree roots for autonomous worker startup.',
    trustedProjectTables(trustedProjectRoots)
  ].join('\n\n')
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
  const preflightEvidence = profilePreflightEvidence({
    mode,
    profileText,
    worktreePath,
    codexHome: profileHome,
    authenticatedHome: usesAuthenticatedCodexHome(task.worker, mode)
  })
  if (!preflightEvidence.dangerousBypassFlagsAbsent) {
    throw new Error('qFoundry worker profile must not include bypass, Yolo, or full-access flags')
  }
  return {
    profileMode: mode,
    profileName,
    codexCommand,
    codexCommandArgs,
    codexHome: profileHome,
    profilePath,
    profileSha256: sha256Text(profileText),
    worktreePath: path.resolve(worktreePath),
    trustedProjectRoots,
    launchCommand,
    authBoundary: usesAuthenticatedCodexHome(task.worker, mode)
      ? 'uses existing authenticated Codex home for auth; no credentials copied into project state'
      : 'uses project-local Codex home; requires independent authentication',
    preflight: {
      ...preflightEvidence,
      checkedAt: now().toISOString(),
      supportsProfile: help.stdout.includes('--profile'),
      supportsCd: help.stdout.includes('--cd'),
      supportsSandbox: help.stdout.includes('--sandbox'),
      supportsAskForApproval: help.stdout.includes('--ask-for-approval')
    }
  }
}
