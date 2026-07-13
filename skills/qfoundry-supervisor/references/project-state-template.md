# qFoundry Project State

Project name: `[PROJECT NAME]`
Current phase: `[preflight|discovery|contract|planning|dispatch|verification|correction|integration|blocked|complete]`
Contract version: `[VERSION]`
Contract approval status: `[draft|approved|superseded|blocked]`
Current base branch: `[BASE REF]`
Last verified timestamp: `[YYYY-MM-DDTHH:MM:SSZ or unknown]`

## Current Supervisor

- Agent: `[Codex or other]`
- Terminal handle: `[resolved handle or unknown]`
- Worktree: `[current worktree id/path]`

## Worktrees

| Worktree | Git branch | Orca worktree ID | Purpose | State |
| --- | --- | --- | --- | --- |
| `[path]` | `[branch]` | `[id]` | `[purpose]` | `[active|idle|stale|removed]` |

## Active Workers

| Worker | Agent ID | Terminal handle | Worktree | Model verification | Current dispatch |
| --- | --- | --- | --- | --- | --- |
| `[name]` | `[agent id]` | `[handle]` | `[worktree]` | `[verified|manual-confirmed|unverified|not applicable]` | `[dispatch id]` |

## Tasks

| qFoundry ID | Orca task ID | Dispatch ID | Status | Owner | Requirements | Acceptance Criteria | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `QF-TASK-001` | `[task_id]` | `[dispatch_id]` | `planned` | `[owner]` | `[REQ-001]` | `[AC-001]` | `[path]` |

Allowed qFoundry statuses:

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

## Correction Tasks

| Correction ID | Original Task | Orca task ID | Status | Failed Requirements | Failed Acceptance Criteria |
| --- | --- | --- | --- | --- | --- |
| `QF-CORR-001` | `[QF-TASK-001]` | `[task_id]` | `[status]` | `[REQ IDs]` | `[AC IDs]` |

## Unresolved Decisions

| Decision ID | Question | Owner | Blocking Task | Status |
| --- | --- | --- | --- | --- |
| `DEC-001` | `[question]` | `[owner]` | `[task]` | `[open|resolved]` |

## Known Risks

| Risk ID | Description | Mitigation | Status |
| --- | --- | --- | --- |
| `RISK-001` | `[description]` | `[mitigation]` | `[open|mitigated|accepted]` |

## Next Actions

- `[Next concrete supervisor action.]`

## Recovery Instructions

1. Re-read `.qfoundry/PROJECT_CONTRACT.md`, `.qfoundry/PROJECT_STATE.md`, and `.qfoundry/DECISION_LOG.md`.
2. Run `orca status --json`.
3. Inspect `orca orchestration task-list --json`.
4. Re-resolve active terminal handles with `orca terminal list --json`.
5. Inspect active dispatches with `orca orchestration dispatch-show --task <task_id> --json`.
6. Continue from the highest qFoundry status that has evidence.
7. Do not reuse stale dispatch IDs or assume worker completion equals acceptance.
