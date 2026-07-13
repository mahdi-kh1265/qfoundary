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
      'under_verification',
      'accepted_with_follow_up',
      'rejected',
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
      '`blocked`',
      'There is no direct Orca `completed` to qFoundry `accepted` shortcut'
    ]) {
      expect(text).toContain(required)
    }
  })

  it('documents smoke evidence without treating this integrity test as end-to-end coverage', () => {
    const text = `${read(skillPath)}\n${read(docsPath)}`
    for (const required of [
      'Codex supervisor session',
      'Antigravity terminal',
      'active Claude model verified',
      'model status explicitly recorded as',
      'injected dispatch',
      'valid `worker_done`',
      'supervisor ran independent tests',
      'deliberate worker defect',
      'supervisor rejection',
      'correction dispatch',
      'restart',
      'recovery continued from `.qfoundry` state',
      'Do not claim a live Antigravity or Claude smoke test'
    ]) {
      expect(text).toContain(required)
    }
  })

  it('records source-backed Antigravity facts without overclaiming Claude verification', () => {
    const text = allQFoundryText()
    expect(text).toContain('Canonical Orca agent id: `antigravity`')
    expect(text).toContain('Detected executable: `agy`')
    expect(text).toContain('Launch command: `agy`')
    expect(text).toContain('agy --conversation <conversationId>')
    expect(text).toContain('model: unverified')
    expect(text).toContain(
      'Never claim Claude completed the task when model identity is unverified'
    )
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
