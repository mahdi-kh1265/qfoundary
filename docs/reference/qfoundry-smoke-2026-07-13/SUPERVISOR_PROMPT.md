# qFoundry Four-Worker Connectivity Smoke Test

Use the qfoundry-supervisor skill to run this live disposable integration smoke test.

You are the actual qFoundry supervisor inside Orca. The external bootstrapper is only observing. You must create and route the tracked tasks yourself using Orca orchestration.

## Project

Project name: qFoundry Four-Worker Connectivity Smoke Test

Purpose: Verify that one Codex supervisor can create, dispatch, observe, and verify four concurrent Codex workers through Orca orchestration.

Explicit user approval: The user explicitly approved this disposable smoke test in the original bootstrap prompt. Treat that as the user-attributable contract approval for this disposable project, but still persist it as DEC-001 and mark the contract status approved. No product development is approved.

## Required State

Create and maintain:

- `.qfoundry/PROJECT_CONTRACT.md`
- `.qfoundry/PROJECT_STATE.md`
- `.qfoundry/DECISION_LOG.md`
- `.qfoundry/reports/`

## Mandatory Dispatch Precondition

Before dispatching any worker task, verify and record that:

- contract status is approved;
- approval is explicitly attributable to the user;
- DEC-001 exists;
- any approval gate created for the contract is resolved;
- no task is dispatched while any of those conditions is missing.

## Four Worker Tasks

Create four distinct tracked Orca tasks with no dependencies. Generate four unique non-secret nonce strings. Each task must create exactly one artifact with exactly its assigned nonce and one trailing newline:

- `artifacts/worker-1.txt`
- `artifacts/worker-2.txt`
- `artifacts/worker-3.txt`
- `artifacts/worker-4.txt`

For each task:

1. Create the tracked Orca task with `orca orchestration task-create --json`.
2. Create a separate disposable worker worktree with `orca worktree create --repo id:9ee5d578-5d11-47bd-a7e5-14b336150bb9 --name <unique-worker-name> --agent codex --setup skip --json`.
3. Capture worktree ID and terminal handle.
4. Wait for `tui-idle`.
5. Dispatch with `orca orchestration dispatch --task <task_id> --to <handle> --inject --json`.
6. Verify with `orca orchestration dispatch-show --task <task_id> --json`.
7. Wait using exactly this rolling coordinator workflow:
   `orca orchestration check --wait --types worker_done,escalation,decision_gate --timeout-ms 900000 --json`
8. Treat timeout as a checkpoint, not failure; inspect task, dispatch, heartbeat, and terminal state before retrying or intervening.
9. Require exactly one valid worker_done per dispatch with matching task and dispatch IDs.
10. Map Orca completed to qFoundry worker_completed, then qFoundry under_verification, then accepted/rejected/blocked only after independent verification.
11. Independently inspect artifact bytes/content, Git diff, and worker report/evidence.
12. Write a verification report under `.qfoundry/reports/`.

## Direct Messaging Test

After all four worker terminals exist, send one status message to `@codex` with a unique message nonce, then verify inbox/check evidence for receipt. Also send one direct status message to exactly one worker terminal and verify it is not attributed to the other workers. Do not confuse these messages with worker task completion.

## Constraints

- Do not merge, push, deploy, publish, delete, or reset orchestration.
- Do not run `orca orchestration reset`.
- Do not modify any important repository.
- Leave all disposable repo/worktrees available for inspection.
- Use no more than four implementation workers concurrently.
- Use only Codex workers for this test.
- If a Codex worker or supervisor asks for manual permission approval in the Orca UI, stop, record it as `blocked_pending_user_decision`, and report exactly what approval is needed.
- Do not claim live Antigravity/Claude; this is a Codex-only connectivity smoke unless explicitly verified otherwise.

## Final Supervisor Report

When done, write `.qfoundry/reports/final-smoke-evidence.md` and also summarize in your terminal:

- supervisor worktree/terminal handle;
- each worker worktree/terminal handle;
- task IDs and dispatch IDs;
- nonces and artifact paths;
- worker_done evidence;
- qFoundry status transitions and verdicts;
- direct/group message evidence;
- rate-limit/process observations;
- failures or limitations.

Start now.
