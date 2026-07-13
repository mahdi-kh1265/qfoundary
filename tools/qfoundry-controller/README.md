# qFoundry Controller

`tools/qfoundry-controller` is an additive sidecar for Phase 2A qFoundry
supervision. It does not redesign Orca UI or modify Orca runtime internals. The
controller drives Orca through the structured JSON CLI, persists restartable
state under `.qfoundry/`, and keeps qFoundry acceptance separate from Orca
`worker_done` completion.

## Architecture

- `bin/qfoundry-controller.mjs`: CLI entry point.
- `src/controller.mjs`: autonomous supervisor loop.
- `src/state-machine.mjs`: qFoundry states, transitions, and approval
  preconditions.
- `src/orca-json-cli.mjs`: structured Orca JSON CLI adapter.
- `src/reviewer.mjs`: review prompt/report creation and command-backed
  supervisor review.
- `profiles/`: scoped Codex worker permission examples.

The controller reads `.qfoundry/controller-state.json`, not a project knowledge
database. The normal qFoundry markdown files remain the human-facing contract,
decision log, and review evidence.

## State Machine

Supported qFoundry states:

```text
planned
ready
dispatched
worker_completed
under_verification
accepted
accepted_with_follow_up
rejected
correction_dispatched
blocked_pending_user_decision
failed
abandoned
```

A valid Orca `worker_done` can move only to `worker_completed`. The controller
then explicitly moves to `under_verification`, invokes the supervisor review,
and only then records `accepted`, `accepted_with_follow_up`, `rejected`, or
`blocked_pending_user_decision`.

## Controller Loop

Launch one autonomous supervised run:

```bash
node tools/qfoundry-controller/bin/qfoundry-controller.mjs run \
  --project /absolute/path/to/project \
  --state .qfoundry/controller-state.json \
  --orca orca \
  --review-command /absolute/path/to/reviewer \
  --wait-timeout-ms 900000 \
  --max-correction-rounds 3
```

The reviewer command reads the generated review input from stdin and must print
strict JSON:

```json
{
  "verdict": "accepted",
  "summary": "Independent verification passed.",
  "failedRequirements": [],
  "failedAcceptanceCriteria": [],
  "testsRun": ["..."],
  "evidence": ["..."],
  "followUp": []
}
```

For live Codex review, use a small wrapper that invokes the installed Codex CLI
with the qFoundry review prompt and prints that strict JSON. Keep the worker
profile scoped as below; do not use `danger-full-access`,
`dangerously-bypass-approvals-and-sandbox`, or Orca global Yolo as the default.

The wait command is fixed to the Phase 2A workflow:

```bash
orca orchestration check --wait \
  --types worker_done,escalation,decision_gate \
  --timeout-ms 900000 \
  --json
```

Timeouts are persisted as checkpoints, not failures. Before the next wait, the
controller inspects active dispatch state through `dispatch-show`.

## State File

Minimal `.qfoundry/controller-state.json`:

```json
{
  "schemaVersion": 1,
  "projectName": "Example",
  "contract": {
    "path": ".qfoundry/PROJECT_CONTRACT.md",
    "status": "approved",
    "approval": {
      "attributedTo": "user",
      "decisionRecordId": "DEC-001",
      "approvalGateResolved": true
    }
  },
  "settings": {
    "waitTimeoutMs": 900000,
    "maxCorrectionRounds": 3
  },
  "tasks": [
    {
      "id": "QF-TASK-001",
      "title": "Implement feature",
      "objective": "Concrete task objective.",
      "status": "ready",
      "requirements": ["REQ-001"],
      "acceptanceCriteria": ["AC-001"],
      "requiredTests": ["pnpm test -- --runInBand"],
      "permittedScope": ["src/feature.ts"],
      "prohibitedActions": ["push", "deploy", "network"],
      "reportPath": ".qfoundry/reports/QF-TASK-001-worker.md",
      "worktree": { "path": "/absolute/path/to/assigned/worktree" },
      "worker": {
        "agentId": "codex",
        "terminalHandle": "term_...",
        "worktreePath": "/absolute/path/to/assigned/worktree"
      }
    }
  ],
  "processedMessages": [],
  "lifecycleEvents": [],
  "checkpoints": []
}
```

If no terminal exists yet, set `"worker": { "agentId": "codex", "create": true,
"worktreeName": "qf-worker-001" }`. The controller will call
`orca worktree create --no-parent --agent <agentId> --json`, persist the
returned startup terminal handle, wait for readiness, and dispatch only to that
concrete handle.

No dispatch occurs unless the contract status is `approved`, approval is
explicitly attributed to `user`, a `DEC-*` decision record is present, and any
created approval gate is resolved.

## Scoped Codex Worker Permissions

Preferred profile: `profiles/codex-worker.permissions.config.toml`.

- Uses current Codex permission profiles.
- Extends `:workspace`.
- Writes only effective workspace roots and safe temp directories.
- Denies `.env`, key, secret, credential, and common credential locations.
- Disables outbound network by default.
- Uses `approvals_reviewer = "auto_review"` for eligible sandbox-boundary
  requests.

Compatibility profile: `profiles/codex-worker.compat.config.toml`.

- Uses `sandbox_mode = "workspace-write"`.
- Uses `approval_policy = "on-request"`.
- Disables sandbox network access.
- Filters common credential environment variables.

The installed Codex CLI inspected during Phase 2A was `codex-cli
0.144.0-alpha.4`. Official Codex docs describe permission profiles as beta and
state that they do not compose with older `sandbox_mode` settings; configure one
system or the other.

## Test Evidence

Run the controller test:

```bash
pnpm exec vitest run --config config/vitest.config.ts tools/qfoundry-controller/src/controller.test.mjs
```

The test creates a disposable project and a fake structured Orca CLI. It proves:

- tracked task dispatch uses an exact terminal handle;
- a deliberate defective worker file sends valid `worker_done`;
- supervisor review runs an independent Node assertion against the file;
- the defective result is rejected with failed requirement and acceptance IDs;
- a correction task is created with a fresh dispatch ID;
- terminal handle re-resolution after restart uses the concrete replacement
  handle;
- the corrected file is independently retested and accepted;
- stale dispatch completion is rejected;
- duplicate `worker_done` is ignored;
- answered worker questions go through reply;
- unresolved questions block on user decision;
- correction retry limit blocks and escalates;
- bounded wait timeout becomes a checkpoint, not task failure.

This is executable controller evidence, not a live Antigravity or Claude smoke
test. A live smoke test still requires an Orca runtime, worker terminal creation,
real injected dispatch, real worker lifecycle messages, and recorded restart
recovery from `.qfoundry` state.

## Remaining Limitations

- The controller expects `.qfoundry/controller-state.json` to be prepared by the
  supervisor or a setup command.
- The review command must print strict JSON; free-form Codex prose is rejected.
- The sidecar does not merge, push, deploy, release, access secrets, or perform
  destructive operations.
- `@codex` group routing is intentionally not used; every lifecycle action uses
  exact task IDs, dispatch IDs, and terminal handles.
