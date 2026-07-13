import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const skillRoot = join(repoRoot, 'skills', 'qfoundry-supervisor')
const skillPath = join(skillRoot, 'SKILL.md')
const docsPath = join(repoRoot, 'docs', 'qfoundry-supervisor.md')
const references = [
  'project-contract-template.md',
  'project-state-template.md',
  'task-spec-template.md',
  'review-report-template.md',
  'decision-log-template.md',
  'permission-policy.md',
  'worker-profiles.md'
]

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

function allQFoundryText(): string {
  const files = [
    skillPath,
    docsPath,
    ...references.map((file) => join(skillRoot, 'references', file))
  ]
  return files.map(read).join('\n')
}

describe('qfoundry supervisor skill integrity', () => {
  it('has valid skill frontmatter and the required name', () => {
    const text = read(skillPath)
    expect(text).toMatch(/^---\r?\n/)
    expect(text).toContain('name: qfoundry-supervisor')
    expect(text).toContain('description: >-')
    expect(text).toContain('contract-first')
    expect(text).toContain('Codex supervising worker')
  })

  it('ships every referenced support file with the skill', () => {
    const skill = read(skillPath)
    for (const file of references) {
      const referencePath = join(skillRoot, 'references', file)
      expect(existsSync(referencePath), `${file} should exist`).toBe(true)
      expect(skill).toContain(`references/${file}`)
    }
  })

  it('documents qFoundry state, approval, dispatch, completion, and verification invariants', () => {
    const text = allQFoundryText()
    for (const required of [
      '.qfoundry/',
      'PROJECT_CONTRACT.md',
      'PROJECT_STATE.md',
      'DECISION_LOG.md',
      'REQ-001',
      'AC-001',
      'explicit approval',
      'worker_done',
      'ready',
      'under_verification',
      'accepted_with_follow_up',
      'rejected',
      'correction_dispatched',
      'blocked_pending_user_decision',
      'failed',
      'orca orchestration task-create',
      'orca orchestration dispatch',
      '--inject'
    ]) {
      expect(text).toContain(required)
    }
    expect(text).toContain('worker completion')
    expect(text).toContain('not proof that the work is accepted')
  })

  it('documents hardened approval and coordinator waiting invariants', () => {
    const text = `${read(skillPath)}\n${read(docsPath)}`
    for (const required of [
      'mandatory dispatch precondition',
      'contract status is exactly `approved`',
      'approval is explicitly attributable to the user',
      'a `DEC-*` decision record exists',
      'any Orca approval gate created for the contract is resolved',
      'No implementation task',
      'may be dispatched unless all of these are true',
      'orca orchestration check --wait',
      '--types worker_done,escalation,decision_gate',
      '--timeout-ms <bounded rolling interval>',
      'Each timeout is a checkpoint, not failure',
      'inspect task status, dispatch status',
      'heartbeat',
      'terminal state'
    ]) {
      expect(text).toContain(required)
    }
  })

  it('documents Orca completion to qFoundry verdict mapping', () => {
    const text = `${read(skillPath)}\n${read(docsPath)}`
    for (const required of [
      'Orca task status `completed`',
      'maps only to qFoundry `worker_completed`',
      'qFoundry `worker_completed`',
      'qFoundry `under_verification`',
      'qFoundry `accepted`',
      '`accepted_with_follow_up`',
      '`rejected`',
      '`blocked_pending_user_decision`',
      '`failed`',
      'There is no direct',
      'Orca `completed` to qFoundry `accepted` shortcut'
    ]) {
      expect(text).toContain(required)
    }
  })

  it('documents the Phase 2A controller without replacing the live smoke standard', () => {
    const text = read(docsPath)
    for (const required of [
      'tools/qfoundry-controller/',
      '.qfoundry/controller-state.json',
      'uses exact terminal handles',
      'not `@codex` group routing',
      'moves `worker_done` only to `worker_completed`',
      'runs independent supervisor review before acceptance',
      'creates fresh correction dispatches after rejection',
      'persists progress under `.qfoundry/controller-state.json`'
    ]) {
      expect(text).toContain(required)
    }
  })

  it('documents smoke evidence without treating this integrity test as end-to-end coverage', () => {
    const text = `${read(skillPath)}\n${read(docsPath)}`
    for (const required of [
      'Codex supervisor/controller session',
      'four distinct Codex worker terminals',
      'separate Codex reviewer process or session',
      'windows-codex-compat',
      'four tracked Orca tasks',
      'injected dispatch',
      'valid `worker_done`',
      'supervisor ran independent tests',
      'deliberate worker defect',
      'supervisor rejection',
      'correction dispatch',
      'worker question answered automatically',
      'unresolved user decision',
      'dependent task released only after prerequisite qFoundry acceptance',
      'restart',
      'recovery continued from `.qfoundry` state',
      'shared Codex-account throttling',
      'Do not claim a live Codex-only four-worker smoke test'
    ]) {
      expect(text).toContain(required)
    }
  })

  it('documents Codex-only defaults, Windows compatibility, and future adapters', () => {
    const text = allQFoundryText()
    for (const required of [
      'The supported MVP path is Codex-only',
      'Primary implementation workers: separate Codex sessions',
      'Independent reviewer: a separate read-only Codex process',
      'Provider-neutral controller interfaces may remain',
      'alternative providers are optional future adapters',
      'First-class Windows compatibility mode: `windows-codex-compat`',
      'workspace-write sandbox mode',
      'approval policy',
      'automatic boundary review',
      'network disabled',
      'effective worktree directory',
      'authenticated Codex home',
      'sensitive environment exclusions',
      'absence of dangerous bypass flags',
      'weaker filesystem granularity',
      'Yolo, full-access, and sandbox-bypass modes remain prohibited'
    ]) {
      expect(text).toContain(required)
    }
  })

  it('documents scheduler and context-packet invariants', () => {
    const text = `${read(skillPath)}\n${read(docsPath)}\n${read(
      join(repoRoot, 'tools', 'qfoundry-controller', 'README.md')
    )}`
    for (const required of [
      '`maxConcurrentWorkers`',
      'default is `2`',
      'tested upper target',
      '`4`',
      'dependencies are satisfied by qFoundry `accepted`',
      'concrete terminal handle',
      'separate worktrees',
      'ownership collisions',
      'persisted',
      'rate-limit',
      'bounded backoff',
      'objective, requirement and acceptance criterion IDs',
      'repository/worktree assignment',
      'dependency state',
      'task and dispatch identities'
    ]) {
      expect(text).toContain(required)
    }
  })

  it('does not include user-specific paths, credentials, or unsafe default guidance', () => {
    const text = allQFoundryText()
    const forbiddenPatterns = [
      /C:\\Users\\/i,
      /khams008/i,
      /ghp_[A-Za-z0-9_]+/,
      /github_pat_[A-Za-z0-9_]+/,
      /--dangerously-bypass/i,
      /--dangerously-skip/i,
      /orchestration reset --all/i,
      /worker_done.*accept/i
    ]
    for (const pattern of forbiddenPatterns) {
      expect(text, `${pattern} should not appear`).not.toMatch(pattern)
    }
    expect(text).toContain('YOUR_GITHUB_USERNAME')
  })

  it('keeps relative references inside the repository', () => {
    for (const file of [
      skillPath,
      docsPath,
      ...references.map((name) => join(skillRoot, 'references', name))
    ]) {
      const rel = relative(repoRoot, file)
      expect(rel.startsWith('..')).toBe(false)
      expect(existsSync(file), `${rel} should exist`).toBe(true)
    }
  })
})
