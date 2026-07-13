---
name: qfoundry-supervisor
description: >-
  Use qFoundry Supervisor for contract-first, supervised multi-agent software
  development on top of Orca: qFoundry projects, Codex supervising worker
  agents, verified worker implementation, supervisor review and correction,
  persistent .qfoundry state, decision logs, explicit approval gates, and
  safe multi-agent task orchestration.
---

# qFoundry Supervisor

qFoundry Supervisor is an operating discipline for using Codex as the
supervisor inside Orca while one or more Codex worker sessions implement
tracked tasks. It builds on the `orca-cli` and `orchestration` skills. Use those
skills for exact command details; this skill defines the qFoundry lifecycle,
state model, safety policy, and verification standard.

The default MVP configuration is:

- Supervisor: Codex.
- Primary implementation workers: separate Codex sessions launched through
  Orca with concrete terminal handles.
- Independent reviewer: a separate read-only Codex process or Codex session.
- Deterministic verification: controlled by qFoundry, never by worker trust.

Provider-neutral controller interfaces may remain in the code. The alternative providers are optional future adapters.
They are not prerequisites for the MVP and must not be presented as the
expected next step unless a later contract explicitly approves that integration.

## Non-Negotiable Rules

- Current repository source and installed CLI help are authoritative.
- A worker saying "done" or sending `worker_done` is completion evidence only,
  never acceptance.
- Do not dispatch implementation before the user explicitly approves the
  project contract.
- Preserve all qFoundry state under `.qfoundry/` so supervision can resume.
- Use Orca tracked tasks and dispatches for supervised implementation.
- Do not use runtime-global orchestration reset to get a clean slate.
- Do not send lifecycle messages from the wrong terminal.
- Do not reuse stale dispatch IDs or stale terminal handles.
- Do not claim a provider, model, or account identity that has not been
  directly verified and recorded.
- Do not merge, push project implementation branches, deploy, spend money,
  access secrets, send external communications, delete valuable data, or weaken
  security controls without explicit user approval.
- Keep provider-specific behavior behind verified adapters. The supported MVP
  default is Codex-only.
- Keep worker permissions scoped. Do not recommend global permission bypass,
  Yolo, full-access, or sandbox-bypass modes as the default.

## Required State

Create or maintain this directory in the supervised project:

```text
.qfoundry/
  PROJECT_CONTRACT.md
  PROJECT_STATE.md
  DECISION_LOG.md
  reports/
```

Use the reference templates in `references/`:

- `references/project-contract-template.md`
- `references/project-state-template.md`
- `references/task-spec-template.md`
- `references/review-report-template.md`
- `references/decision-log-template.md`
- `references/permission-policy.md`
- `references/worker-profiles.md`

qFoundry task state is separate from Orca task status. At minimum, track:

- `planned`
- `ready`
- `dispatched`
- `worker_completed`
- `under_verification`
- `accepted`
- `accepted_with_follow_up`
- `rejected`
- `correction_dispatched`
- `blocked_pending_user_decision`
- `failed`
- `abandoned`

Orca may mark a task `completed` after a valid `worker_done`; qFoundry must not
mark the task `accepted` until supervisor verification passes.

Status mapping:

- Orca task status `completed` means Orca received a valid lifecycle completion
  signal; it maps only to qFoundry `worker_completed`.
- qFoundry `worker_completed` means the worker report and `worker_done` are
  available but have not been independently accepted.
- qFoundry `under_verification` means the supervisor is independently checking
  the worker result against requirements, acceptance criteria, and evidence.
- qFoundry `accepted`, `accepted_with_follow_up`, `rejected`,
  `blocked_pending_user_decision`, or `failed` records the supervisor verdict
  after independent verification or an explicit blocker. There is no direct
  Orca `completed` to qFoundry `accepted` shortcut.

## Phase 1: Preflight

Before editing or dispatching, inspect and record:

- `orca status --json`
- whether the Orca CLI is the intended Orca CLI for this runtime
- whether orchestration commands are callable
- existing Orca task and dispatch state
- existing `.qfoundry/` state
- current supervisor agent identity when observable
- Codex CLI availability for worker and reviewer processes
- available Codex worker profiles and terminal handles
- selected worker profile mode, including `windows-codex-compat` when used
- whether reviewer execution is a separate Codex process or session
- unmet prerequisites, honestly labeled

Do not reset orchestration state. If unrelated Orca state exists, work around it
with unique task names and explicit task/dispatch IDs.

## Phase 2: Repository Discovery

Before proposing implementation, inspect:

- repository structure
- package manager and lockfiles
- build, lint, typecheck, and test commands
- architecture and contribution docs
- current branch, remotes, worktrees, and uncommitted changes
- relevant implementation files
- security, privacy, compatibility, and dependency constraints

Separate observed facts from assumptions in the contract.

## Phase 3: Project Contract

Draft `.qfoundry/PROJECT_CONTRACT.md` with stable versioning. The contract must
include:

- project name
- purpose
- intended users
- user-visible outcomes
- functional requirements
- non-functional requirements
- non-goals
- architecture constraints
- compatibility constraints
- security constraints
- privacy constraints
- dependency policy
- testing requirements
- documentation requirements
- external integrations
- prohibited actions
- definition of done
- open decisions
- assumptions
- risks
- explicit approval record

Every requirement must use stable IDs such as `REQ-001`. Every acceptance
criterion must use stable IDs such as `AC-001`. Requirements and acceptance
criteria must be testable.

Present the contract and ask for explicit approval. Prefer an Orca decision
gate or ask/reply flow when available, and also persist the approval in
`.qfoundry/PROJECT_CONTRACT.md` and `.qfoundry/DECISION_LOG.md`. Silence,
continuation, or a request for a draft is not approval.

Contract approval is a mandatory dispatch precondition. No implementation task
may be dispatched unless all of these are true:

- contract status is exactly `approved`
- approval is explicitly attributable to the user
- a `DEC-*` decision record exists in `.qfoundry/DECISION_LOG.md`
- any Orca approval gate created for the contract is resolved

If any condition is missing, keep the task undispatched, record the missing
evidence, and ask or escalate instead of proceeding.

## Phase 4: Planning

After approval, create or update `.qfoundry/PROJECT_STATE.md` and break the
contract into small, verifiable tasks. Each task spec must include:

- task title
- objective
- related requirement IDs
- related acceptance criterion IDs
- relevant repository context
- likely affected subsystem
- permitted edit scope
- constraints
- prohibited actions
- dependencies
- required tests
- required documentation
- required completion report
- expected evidence
- ownership
- correction history, when applicable

Create real Orca tasks with `orca orchestration task-create --json`. Do not use
untracked chat prompts as substitutes. Prefer parallelism only when tasks are
independent and unlikely to edit the same files.

## Phase 5: Worker Selection

Use Codex as the default implementation worker provider. Each implementation
task runs in a separate Codex session or process with its own exact Orca
terminal handle. Reviewer work must use a separate Codex process or session so
that supervisor acceptance is not delegated to the implementation worker.

The controller's default `maxConcurrentWorkers` is `2`; the tested upper target
for the current MVP is `4`. The scheduler may dispatch multiple ready tasks
only when all of these are true:

- dependencies are satisfied by qFoundry `accepted` or
  `accepted_with_follow_up`, not merely Orca `completed`
- a concrete terminal handle is assigned or created for each worker
- overlapping work in the same repository uses separate worktrees
- obvious file or subsystem ownership collisions have been checked
- task, dispatch, worker, worktree, and repository mappings are persisted
- rate-limit or throttle signals trigger bounded backoff instead of duplicate
  worker creation

Never use `@codex` group routing for qFoundry lifecycle work. Dispatch, wait,
reply, and verification attribution must use exact task IDs, dispatch IDs, and
terminal handles.

Use `references/worker-profiles.md` for worker roles. Provider-neutral
interfaces can remain as future adapter seams, but alternative providers are
not part of the supported MVP path until their CLI behavior, lifecycle
messages, profile isolation, and model attribution have been verified.

### Codex Worker Profile Modes

Preferred mode: the granular Codex permission profile, when the installed Codex
version supports it. It should scope writes to the assigned worktree and deny
common credential locations.

First-class Windows compatibility mode: `windows-codex-compat`. Use it when the
preferred permission-profile backend is blocked or unavailable on the host. Its
preflight must verify and record:

- workspace-write sandbox mode
- approval policy
- automatic boundary review configuration
- network disabled
- effective worktree directory
- authenticated Codex home being used, without copying or printing credentials
- sensitive environment exclusions
- absence of dangerous bypass flags

`windows-codex-compat` is suitable for controlled personal development, but it
offers weaker filesystem granularity than the preferred permission profile.
Unsafe Yolo, full-access, and sandbox-bypass modes remain prohibited.

## Phase 6: Worktree Selection

Use a new isolated worktree when:

- the task is independent
- it does not depend on uncommitted state
- parallel modification is safe
- isolated repository state is valuable

Use a fresh terminal in the current worktree when:

- the task must inspect the exact current branch
- uncommitted artifacts are required
- the task is review-only
- a new worktree would omit needed state

Distinguish Orca sidebar lineage, Git branch base, orchestration lifecycle, and
terminal identity. Prefer Orca agent-first worktree creation when supported.
Use the exact worktree id and startup terminal handle returned by the CLI. If a
handle is stale after restart, re-resolve it with `orca terminal list --json`.

## Phase 7: Dispatch

For each implementation task:

1. Re-check the mandatory contract approval precondition.
2. Create a real Orca task.
3. Verify it appears in `orca orchestration task-list --json`.
4. Launch or select one worker terminal.
5. Wait for readiness with `orca terminal wait --for tui-idle --timeout-ms ... --json`.
6. Dispatch with `orca orchestration dispatch --task <task_id> --to <handle> --inject --json`
   when the target is a recognized agent CLI.
7. Verify the dispatch with `orca orchestration dispatch-show --task <task_id> --json`.
8. Persist task ID, dispatch ID, worker handle, worktree ID, and qFoundry state.

The worker must receive the exact task specification, requirement IDs,
acceptance criteria, permitted scope, prohibited actions, tests, and reporting
requirements. Controller-generated context packets must include the task
objective, requirement IDs, acceptance criterion IDs, relevant decisions,
repository ID and worktree, permitted subsystem or files, prohibited actions,
required deterministic checks, expected completion report, dependency state,
and task and dispatch identities.

## Phase 8: Worker Reporting

Require exactly one valid `worker_done` from the worker terminal. The completion
report must contain:

- task ID
- dispatch ID
- worker and harness name
- active model name only when verifiable
- summary
- files modified
- files added
- tests run
- test results
- commands run
- assumptions
- deviations from the task
- unresolved issues
- risks
- recommended follow-up
- report path

For long tasks, require heartbeat messages according to the orchestration
preamble. Use `ask` for blocking worker questions. Treat wait timeouts as
checkpoints, not automatic failures.

Use the coordinator waiting workflow with a bounded rolling interval:

```bash
orca orchestration check --wait
  --types worker_done,escalation,decision_gate
  --timeout-ms <bounded rolling interval>
  --json
```

Each timeout is a checkpoint, not failure. Before retrying or intervening,
inspect task status, dispatch status, worker heartbeat history, and terminal
state. Continue waiting only when evidence shows the worker is still healthy;
otherwise ask, escalate, block, or recover according to the contract and current
Orca state.

## Phase 9: Verification

After `worker_done`, set qFoundry state to `under_verification` and
independently:

- read the full worker report
- inspect every modified and added file
- inspect the complete Git diff
- check changes outside permitted scope
- compare implementation against each referenced requirement
- compare implementation against each referenced acceptance criterion
- run relevant tests independently
- inspect actual test output
- run lint, typecheck, build, or targeted validation where applicable
- check regressions, error handling, edge cases, and platform behavior
- check security and privacy implications
- check local, remote, and SSH worktree implications when relevant
- check for weakened tests, placeholder code, fabricated results, and
  unnecessary dependencies
- check documentation changes when behavior changed

Write a report under `.qfoundry/reports/` using
`references/review-report-template.md`. The verdict must be exactly one of:

- `accepted`
- `accepted_with_follow_up`
- `rejected`
- `blocked_pending_user_decision`

## Phase 10: Rejection And Correction

When work is rejected:

- cite failed requirement IDs
- cite failed acceptance criterion IDs
- include concrete file, diff, or test evidence
- explain expected behavior
- create a correction task linked to the original task
- dispatch it through Orca
- independently reverify the correction

Do not silently edit rejected worker code as supervisor unless the user assigns
implementation ownership to the supervisor. Do not mark the original feature
accepted until correction verification passes.

## Phase 11: Integration Approval

Before proposing merge or project implementation push, provide:

- completed requirements
- acceptance criteria and evidence
- changed files
- tests run and results
- known limitations
- unresolved risks
- dependency changes
- security implications
- exact proposed Git operation

Require explicit user approval before merge, push, deployment, release,
production access, spending, external communication, secret access, destructive
operations, or security weakening.

## Failure And Recovery

For supervisor restart, Orca restart, stale handles, stale dispatches, missing
heartbeats, worker crash, failed tests, missing reports, unavailable Codex
worker or reviewer execution, unverified provider/model identity, unresolved
user decisions, account throttling, and repeated task failures:

- preserve `.qfoundry/` state before risky transitions
- inspect current Orca task and dispatch state before retrying
- never reuse stale dispatch IDs
- never send lifecycle messages from a different terminal
- do not reset runtime-global state while unrelated coordination may exist
- treat activity and heartbeats as liveness, not completion
- treat silence as uncertain
- block and escalate after repeated verified failures
- record every manual override in `.qfoundry/DECISION_LOG.md`
- never invent a missing result

## End-To-End Smoke Evidence

A live qFoundry smoke test is valid only when each evidence item was actually
observed in a disposable project:

- Codex supervisor/controller session running with `qfoundry-supervisor` loaded
- four distinct Codex worker terminals created or re-resolved with exact
  terminal handles
- separate Codex reviewer process or session recorded
- selected worker profile mode recorded, including `windows-codex-compat`
  preflight evidence when used
- four tracked Orca tasks created and four injected dispatches observed without
  group addressing
- coordinator wait command observed with `worker_done`, `escalation`, or
  `decision_gate` result handling
- valid `worker_done` received from the worker terminal for the expected task
  and dispatch
- supervisor ran independent tests and inspected their real output
- deliberate worker defect introduced and supervisor rejection recorded
- correction dispatch created and verified independently
- worker question answered automatically from the approved contract when the
  answer is unambiguous
- unresolved user decision blocked only the affected task, then resumed through
  the qFoundry decision command
- dependent task released only after prerequisite qFoundry acceptance
- restart performed and recovery continued from `.qfoundry` state without
  reusing stale handles or dispatch IDs
- shared Codex-account throttling or lack of throttling recorded, including
  any scheduler backoff and proof that live tasks were preserved

Do not claim a live Codex-only four-worker smoke test unless these observations
were actually executed and recorded. Do not claim any live Antigravity or Claude
smoke result unless that separate adapter test was actually executed.

## First Prompt

Use this prompt to start a supervised project:

```text
Use the qfoundry-supervisor skill to supervise this project.

Begin in discovery mode. Inspect the repository, but do not modify
implementation files or dispatch workers yet.

My initial project goal is:

[PROJECT GOAL]

Create a complete project contract with stable requirement and acceptance
criterion IDs. Present it for explicit approval before implementation.

After approval, create tracked Orca tasks and use no more than two Codex
implementation workers concurrently by default. Use exact terminal handles,
separate worktrees for overlapping repository work, and qFoundry acceptance
before releasing dependent tasks.

For every worker completion, inspect the full diff, independently run the
tests, compare the result to the approved contract, and either accept,
reject, or block it with evidence.

Do not merge, push project implementation, deploy, spend money, access
secrets, send external communications, or delete important data without
my explicit approval.
```
