# qFoundry Project Contract

Contract version: `v1.0-approved`
Project name: `qFoundry Four-Worker Connectivity Smoke Test`
Date: `2026-07-13`
Supervisor: `Codex`
Repository: `C:\Users\khams008\orca\workspaces\qfoundry-orca-smoke-20260713-003427\qf-smoke-supervisor-manual`
Base branch/ref: `qf-smoke-supervisor-manual` at `a1004952f36067ae9deae2611a4abd6813647e41`

## Approval Status

Status: `approved`
Approved by: `user`
Approved at: `2026-07-13T05:43:53Z`
Approval mechanism: `Explicit user-attributable approval recorded in SUPERVISOR_PROMPT.md for this disposable smoke test, plus current user instruction to read and execute that prompt.`
Approval gate status: `none created; no approval gate is unresolved`

No product development is approved.

## Purpose

Verify that one Codex supervisor can create, dispatch, observe, and verify four concurrent Codex workers through Orca orchestration.

## Intended Users

- `USER-001`: qFoundry and Orca maintainers/operators validating live orchestration connectivity in a disposable repository.

## User-Visible Outcomes

- `OUTCOME-001`: Four tracked Orca tasks are created and dispatched to four separate Codex worker worktrees.
- `OUTCOME-002`: Each worker creates exactly one assigned artifact containing exactly its assigned nonce and one trailing newline.
- `OUTCOME-003`: The supervisor receives and verifies exactly one valid `worker_done` per dispatch.
- `OUTCOME-004`: Direct and group orchestration messages are sent and verified without being confused with task completion.
- `OUTCOME-005`: The supervisor writes qFoundry verification reports and a final smoke evidence report.

## Functional Requirements

- `REQ-001`: The supervisor must perform this as a live disposable Orca/qFoundry integration smoke test using Orca orchestration runtime state.
- `REQ-002`: The supervisor must create four distinct tracked Orca tasks with no dependencies using `orca orchestration task-create --json`.
- `REQ-003`: The supervisor must create one separate disposable Codex worker worktree per task with `orca worktree create --repo id:9ee5d578-5d11-47bd-a7e5-14b336150bb9 --name <unique-worker-name> --agent codex --setup skip --json`.
- `REQ-004`: The supervisor must capture each worker worktree ID and terminal handle, wait for `tui-idle`, dispatch with `orca orchestration dispatch --task <task_id> --to <handle> --inject --json`, and verify each dispatch with `orca orchestration dispatch-show --task <task_id> --json`.
- `REQ-005`: Each worker task must create exactly one artifact at its assigned path containing exactly its assigned nonce and one trailing newline.
- `REQ-006`: The supervisor must wait for completion using exactly `orca orchestration check --wait --types worker_done,escalation,decision_gate --timeout-ms 900000 --json`, treating timeouts as checkpoints rather than failures.
- `REQ-007`: The supervisor must require exactly one valid `worker_done` per dispatch with matching task ID and dispatch ID.
- `REQ-008`: The supervisor must map Orca task completion only to qFoundry `worker_completed`, then move to `under_verification`, then independently decide `accepted`, `rejected`, or `blocked`.
- `REQ-009`: The supervisor must independently inspect artifact bytes/content, Git diff, and worker report/evidence for each worker.
- `REQ-010`: After all four worker terminals exist, the supervisor must send one status message to `@codex` with a unique message nonce and verify receipt evidence.
- `REQ-011`: After all four worker terminals exist, the supervisor must send one direct status message to exactly one worker terminal and verify that it is not attributed to the other workers.
- `REQ-012`: The supervisor must write a verification report under `.qfoundry/reports/` for each worker and `.qfoundry/reports/final-smoke-evidence.md` when complete.

## Non-Functional Requirements

- `REQ-101`: Use no more than four implementation workers concurrently.
- `REQ-102`: Use only Codex workers for this test.
- `REQ-103`: Preserve qFoundry state under `.qfoundry/` so the smoke test can resume.
- `REQ-104`: Leave all disposable repository worktrees available for inspection.
- `REQ-105`: Keep all generated nonce strings non-secret.
- `REQ-106`: If a Codex worker or supervisor asks for manual permission approval in Orca UI, stop, record `blocked_pending_user_decision`, and report the exact approval needed.

## Acceptance Criteria

- `AC-001`: `REQ-001` is satisfied when `orca status --json` and orchestration commands show a reachable Orca runtime and live task/dispatch state.
  - Related requirements: `REQ-001`
  - Evidence expected: Captured Orca status, task list, and dispatch-show output summarized in qFoundry state or reports.
- `AC-002`: `REQ-002` is satisfied when four distinct Orca task IDs exist and are recorded in `.qfoundry/PROJECT_STATE.md`.
  - Related requirements: `REQ-002`
  - Evidence expected: `orca orchestration task-list --json` and persisted task IDs.
- `AC-003`: `REQ-003` and `REQ-004` are satisfied when four worker worktree IDs, terminal handles, and dispatch IDs are recorded.
  - Related requirements: `REQ-003`, `REQ-004`
  - Evidence expected: worktree create, terminal wait, dispatch, and dispatch-show outputs.
- `AC-004`: `REQ-005` is satisfied when `artifacts/worker-1.txt` contains `qf-1-66eb12ac8f284e4a\n` and no other bytes.
  - Related requirements: `REQ-005`
  - Evidence expected: supervisor byte/content inspection and Git diff.
- `AC-005`: `REQ-005` is satisfied when `artifacts/worker-2.txt` contains `qf-2-0af69bd244184edb\n` and no other bytes.
  - Related requirements: `REQ-005`
  - Evidence expected: supervisor byte/content inspection and Git diff.
- `AC-006`: `REQ-005` is satisfied when `artifacts/worker-3.txt` contains `qf-3-347b89cd86e442f4\n` and no other bytes.
  - Related requirements: `REQ-005`
  - Evidence expected: supervisor byte/content inspection and Git diff.
- `AC-007`: `REQ-005` is satisfied when `artifacts/worker-4.txt` contains `qf-4-1f5e5cebe14647da\n` and no other bytes.
  - Related requirements: `REQ-005`
  - Evidence expected: supervisor byte/content inspection and Git diff.
- `AC-008`: `REQ-006` and `REQ-007` are satisfied when each dispatch has exactly one matching valid `worker_done` message recorded.
  - Related requirements: `REQ-006`, `REQ-007`
  - Evidence expected: coordinator wait output and worker_done payloads.
- `AC-009`: `REQ-008` and `REQ-009` are satisfied when each qFoundry task has the status sequence `planned -> dispatched -> worker_completed -> under_verification -> accepted|rejected|blocked` with a report.
  - Related requirements: `REQ-008`, `REQ-009`
  - Evidence expected: `.qfoundry/PROJECT_STATE.md` and per-task review reports.
- `AC-010`: `REQ-010` is satisfied when one `@codex` status message with unique nonce `qf-msg-group-37c5bcaa0ee34838` has receipt/check evidence.
  - Related requirements: `REQ-010`
  - Evidence expected: orchestration send/check evidence.
- `AC-011`: `REQ-011` is satisfied when one direct status message with unique nonce `qf-msg-direct-e3d43065fa384807` is verified against the selected worker and not attributed to the other workers.
  - Related requirements: `REQ-011`
  - Evidence expected: orchestration send/check evidence and non-recipient verification.
- `AC-012`: `REQ-012` is satisfied when all required reports exist and include task IDs, dispatch IDs, nonces, worker_done evidence, status transitions, message evidence, rate-limit/process observations, failures, and limitations.
  - Related requirements: `REQ-012`
  - Evidence expected: `.qfoundry/reports/final-smoke-evidence.md`.

## Non-Goals

- `NOGOAL-001`: No product feature development is approved.
- `NOGOAL-002`: No Antigravity or Claude smoke validation is in scope.
- `NOGOAL-003`: No merge, push, deploy, publish, destructive cleanup, or orchestration reset is in scope.

## Architecture Constraints

- `ARCH-001`: Use Orca orchestration tasks and dispatches; chat-only or non-Orca worker execution does not satisfy this contract.
- `ARCH-002`: Use the exact repository selector `id:9ee5d578-5d11-47bd-a7e5-14b336150bb9` for disposable worker worktree creation.
- `ARCH-003`: Use one worker worktree and one Codex agent terminal per task.

## Compatibility Constraints

- `COMPAT-001`: Commands are executed from Windows PowerShell in the current Orca-managed worktree.
- `COMPAT-002`: Artifacts must be plain text with LF newline validation.
- `COMPAT-003`: The smoke test depends on a reachable local Orca runtime and enabled orchestration commands.

## Security Constraints

- `SEC-001`: Nonces must be non-secret and safe to persist.
- `SEC-002`: Do not print, retrieve, or request secrets.
- `SEC-003`: Do not weaken security controls or request broad permission bypass.

## Privacy Constraints

- `PRIV-001`: Do not send external communications.
- `PRIV-002`: Keep the smoke test local to the disposable repository and Orca runtime.

## Dependency Policy

- No dependency additions, upgrades, or external package downloads are approved.

## Testing Requirements

- `TEST-001`: Run Orca status/task/dispatch checks.
- `TEST-002`: Inspect artifact bytes/content independently after worker completion.
- `TEST-003`: Inspect full Git diff independently after worker completion.
- `TEST-004`: Verify worker reports/evidence independently.
- `TEST-005`: Verify direct and group message evidence independently.

## Documentation Requirements

- `DOC-001`: Maintain `.qfoundry/PROJECT_CONTRACT.md`, `.qfoundry/PROJECT_STATE.md`, and `.qfoundry/DECISION_LOG.md`.
- `DOC-002`: Write per-task review reports and final smoke evidence under `.qfoundry/reports/`.

## External Integrations

- Local Orca runtime only. No external service integration is approved.

## Prohibited Actions

- Do not merge, push, deploy, publish, delete valuable data, reset orchestration, or run `orca orchestration reset`.
- Do not modify important repositories outside the disposable smoke-test worktrees.
- Do not claim live Antigravity or Claude validation.
- Do not dispatch tasks while the mandatory dispatch precondition is missing.

## Definition Of Done

- All four worker tasks have been created, dispatched, completed with exactly one valid matching `worker_done`, independently verified, and given qFoundry verdicts.
- The group and direct messaging tests have been performed and verified.
- `.qfoundry/reports/final-smoke-evidence.md` exists with all evidence requested by `SUPERVISOR_PROMPT.md`.
- Any blocker, timeout, manual approval need, or limitation is explicitly recorded.

## Open Decisions

- None. `DEC-001` records the approved disposable smoke-test scope.

## Assumptions

- `ASM-001`: The repository is disposable based on `README.md` and `SUPERVISOR_PROMPT.md`.
- `ASM-002`: `SUPERVISOR_PROMPT.md` is user-authorized project direction for this run.
- `ASM-003`: The current shell is running in Windows PowerShell.
- `ASM-004`: The Orca runtime may need time to become reachable before task creation.

## Risks

- `RISK-001`: Orca runtime is currently `starting` and unreachable; task creation and dispatch are blocked until it becomes reachable.
- `RISK-002`: Codex worker terminals may ask for manual permission approval; the contract requires stopping and reporting the needed approval.
- `RISK-003`: Group message verification can be ambiguous if unrelated Codex terminals exist; the final report must distinguish observed evidence from inference.

## Change History

| Version | Date | Author | Summary |
| --- | --- | --- | --- |
| `v1.0-approved` | `2026-07-13` | `Codex` | Initial approved disposable smoke-test contract from `SUPERVISOR_PROMPT.md`. |
