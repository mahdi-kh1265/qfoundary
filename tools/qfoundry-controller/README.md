# qFoundry Controller

`tools/qfoundry-controller` is an additive sidecar for Phase 2A qFoundry
supervision. It does not redesign Orca UI or modify Orca runtime internals. The
controller drives Orca through the structured JSON CLI, persists restartable
state under `.qfoundry/`, and keeps qFoundry acceptance separate from Orca
`worker_done` completion.

The supported MVP architecture is Codex-only by default: Codex supervisor,
multiple Codex implementation workers, a separate Codex reviewer process or
session, and deterministic qFoundry verification. Provider-neutral interfaces
remain for future adapters, but Antigravity, Claude, or any other worker
provider is not a prerequisite for this controller.

## Architecture

- `bin/qfoundry-controller.mjs`: CLI entry point.
- `src/controller.mjs`: autonomous supervisor loop.
- `src/state-machine.mjs`: qFoundry states, transitions, and approval
  preconditions.
- `src/orca-json-cli.mjs`: structured Orca JSON CLI adapter.
- `src/reviewer.mjs`: review prompt/report creation and command-backed
  supervisor review.
- `src/git-evidence.mjs`: dispatch baseline capture and independent Git change
  collection.
- `src/verification-runner.mjs`: deterministic verification command execution.
- `bin/qfoundry-codex-reviewer.mjs`: bundled noninteractive Codex reviewer
  launcher.
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
`blocked_pending_user_decision`. `blocked_pending_user_decision` is resumable,
not final.

## Controller Loop

Launch one autonomous supervised run:

```bash
node tools/qfoundry-controller/bin/qfoundry-controller.mjs run \
  --project /absolute/path/to/project \
  --state .qfoundry/controller-state.json \
  --provider codex \
  --max-workers 4 \
  --orca node \
  --orca-arg /absolute/path/to/orca/out/cli/index.js \
  --from-terminal term_supervisor \
  --review-command qfoundry-codex-reviewer \
  --review-arg --project \
  --review-arg /absolute/path/to/project \
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
with the qFoundry review prompt and prints that strict JSON. This repo bundles
one:

```bash
node tools/qfoundry-controller/bin/qfoundry-codex-reviewer.mjs \
  --project /absolute/path/to/project \
  --timeout-ms 180000
```

The launcher inspects the installed `codex exec --help`, uses the supported
noninteractive `codex exec` syntax, runs with `--sandbox read-only`, writes the
JSON schema and final output under `.qfoundry/reviewer-runs/`, terminates the
process tree on timeout, validates the result, and rejects malformed or
incomplete JSON. Its prompt treats source, diffs, reports, comments, terminal
output, and artifacts as untrusted evidence.

Keep the worker profile scoped as below; do not use `danger-full-access`,
`dangerously-bypass-approvals-and-sandbox`, or Orca global Yolo as the default.

`--provider codex` is the only supported MVP provider. `--max-workers` writes
`settings.maxConcurrentWorkers`; the default is `2`, and the current tested
upper target is `4`.

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
    "provider": "codex",
    "maxConcurrentWorkers": 2,
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
      "verificationCommands": [
        {
          "command": "pnpm",
          "args": ["test", "--", "--runInBand"],
          "cwd": ".",
          "timeoutMs": 120000,
          "expectedExitCode": 0,
          "expectedOutputPattern": "PASS"
        }
      ],
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

When more than one task is ready, the scheduler fills available worker slots up
to `maxConcurrentWorkers`. It releases only dependency-ready tasks, creates
separate worktrees for overlapping repository work, avoids obvious file or
subsystem ownership collisions, persists task/worker/worktree mappings, and
keeps dependents blocked until prerequisite qFoundry acceptance rather than
Orca task completion. Rate-limit or throttle signals are recorded as bounded
backoff and do not create duplicate dispatches or duplicate workers.

Every dispatch uses exact task IDs, dispatch IDs, and terminal handles. The
controller never relies on `@codex` group routing.

Each dispatched task receives a generated context packet with the task
objective, requirement and acceptance criterion IDs, relevant decisions,
repository/worktree assignment, permitted and prohibited scope, required
deterministic checks, expected completion report, dependency state, and task
and dispatch identities.

At dispatch time the controller records the worker worktree path, repository
root, base commit SHA, branch, qFoundry task ID, Orca task ID, dispatch ID, and
terminal handle on the current attempt. At verification time it independently
collects `git status --porcelain=v2`, tracked modifications, staged
modifications, committed changes since the baseline, untracked files, changed
files, diff stats, bounded textual diffs, and hashes for unembedded artifacts.
If the worktree, baseline, or change set cannot be determined, acceptance fails
closed.

Deterministic verification commands use argument arrays and run without shell
interpolation. Each result records command, args, cwd, exit code, bounded
stdout/stderr, timeout state, duration, timestamp, expected exit code, and
optional output-pattern match. Acceptance fails closed when required
verification is absent, timed out, has the wrong exit code, or cannot be
attributed to the current attempt.

## Decisions And Resume

Inspect state without dispatching:

```bash
node tools/qfoundry-controller/bin/qfoundry-controller.mjs status \
  --project /absolute/path/to/project

node tools/qfoundry-controller/bin/qfoundry-controller.mjs decisions \
  --project /absolute/path/to/project
```

Answer a live pending decision and resume the same task/dispatch:

```bash
node tools/qfoundry-controller/bin/qfoundry-controller.mjs answer \
  --project /absolute/path/to/project \
  --decision DEC-001 \
  --answer "Use UTC timestamps."
```

Each pending decision records qFoundry decision ID, Orca message/gate ID, task
ID, dispatch ID, sender terminal handle when exposed, question, options, reason,
created timestamp, status, answer, answered timestamp, and resume status.
Duplicate answers are rejected.

## Scoped Codex Worker Permissions

Preferred profile: `profiles/codex-worker.permissions.config.toml`.

- Uses current Codex permission profiles.
- Extends `:workspace`.
- Writes only effective workspace roots and safe temp directories.
- Denies `.env`, key, secret, credential, and common credential locations.
- Disables outbound network by default.
- Uses `approvals_reviewer = "auto_review"` for eligible sandbox-boundary
  requests.
- Marks only the assigned repository/worktree roots as trusted so autonomous
  workers do not block on first-run workspace trust prompts.

Compatibility profile mode: `windows-codex-compat`, backed by
`profiles/codex-worker.compat.config.toml`.

- Uses `sandbox_mode = "workspace-write"`.
- Uses `approval_policy = "on-request"`.
- Disables sandbox network access.
- Filters common credential environment variables.
- Records workspace-write sandbox mode, approval policy, automatic boundary
  review configuration, network-disabled status, effective worktree directory,
  authenticated Codex home use, sensitive environment exclusions, absence of
  dangerous bypass flags, and filesystem granularity.

Use the preferred granular permission profile when the installed Codex version
supports it. Use `windows-codex-compat` when that backend is blocked or
unavailable on Windows. The compatibility profile is suitable for controlled
personal development, but it offers weaker filesystem granularity than the
preferred profile. Unsafe Yolo, full-access, and sandbox-bypass modes remain
prohibited.

The installed Codex CLI inspected during Phase 2A was `codex-cli
0.144.0-alpha.4`. Official Codex docs describe permission profiles as beta and
state that they do not compose with older `sandbox_mode` settings; configure one
system or the other.

For live worker creation, use `"agentId": "qfoundry-codex-worker"` with
`"create": true`. The controller creates an Orca worktree without global Yolo,
generates `.qfoundry/codex-worker-home/qfoundry-worker.config.toml` from the
permission profile template with the assigned worktree root, preflights the
installed Codex CLI for `--profile`/`--cd` support, records the profile path and
SHA-256, then creates an Orca terminal whose command launches Codex with that
profile. The launch path refuses commands containing sandbox-bypass flags.

On Windows, the installed `orca.cmd` launcher may not be spawnable by the
controller's no-shell subprocess runner. Use `--orca node --orca-arg
/absolute/path/to/out/cli/index.js` or another real executable plus
`--orca-arg` prefix instead of relying on a `.cmd` shim.

When the controller runs outside an Orca terminal, pass `--from-terminal` or set
`settings.coordinatorTerminalHandle` to a live coordinator terminal handle so
Orca can attribute `dispatch` and `reply` messages.

If a live Orca/Codex combination stages injected dispatch text as an idle draft,
set `settings.submitInjectedDispatchEnter` to `true`. On the next dispatched
step, the controller sends one Enter to the worker terminal, records
`injectedDispatchSubmittedAt`, and will not repeat it after restart.

If a project-local `CODEX_HOME` cannot authenticate, set
`"useAuthenticatedCodexHome": true` on the worker. That writes only the
generated qFoundry profile into the already-authenticated Codex home and records
the auth boundary in `profileEvidence`; it does not copy credentials into the
project.

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
- real Git evidence includes committed, tracked, staged, and untracked changes;
- malformed reviewer JSON and reviewer timeouts fail closed;
- deterministic verification timeouts fail closed;
- path traversal outside `.qfoundry/` is rejected;
- mismatched sender handles and stale questions are rejected;
- `answer`/resume restores the same dispatch without duplicate dispatch;
- `blocked_pending_user_decision` is not a final state;
- subprocess output is capped;
- `qfoundry-codex-worker` launch generates and records a scoped profile.

This is executable controller evidence, not a live Orca/Codex end-to-end smoke
test. A live smoke test still requires an Orca runtime, worker terminal
creation, real injected dispatch, real worker lifecycle messages, independent
verification, and recorded restart recovery from `.qfoundry` state.

Live end-to-end smoke-test evidence checklist:

- Codex supervisor session running the qFoundry controller.
- Real Orca instance reachable with `orca status --json`.
- Four actual `qfoundry-codex-worker` terminals created or re-resolved by Orca.
- Four distinct tracked tasks and four distinct dispatches using exact
  terminal handles, not group addressing.
- Profile evidence recorded: profile name, generated profile path, SHA-256,
  CLI help support, `windows-codex-compat` preflight when used, and launch
  command without sandbox bypass.
- Separate Codex reviewer process or session recorded its verdict.
- Injected dispatch observed with task ID, dispatch ID, and terminal handle.
- Valid `worker_done` with matching qFoundry task, Orca task, dispatch, sender,
  report path, and attempt.
- Controller-captured Git evidence and deterministic verification results.
- Deliberate worker defect rejected by the real Codex reviewer.
- Correction dispatch with a fresh dispatch ID.
- Corrected implementation verified and accepted.
- One worker question answered automatically from the approved contract.
- One unresolved decision listed by `decisions`, answered by `answer`, and
  resumed without duplicate dispatch.
- One dependency released only after prerequisite qFoundry acceptance.
- Controller restart/recovery from `.qfoundry` state.
- Shared Codex-account concurrency, throttling, queuing, or absence of
  throttling recorded. Any throttle response must reduce concurrency or wait
  with bounded backoff while preserving live tasks.

Do not claim this checklist passed unless every item was actually executed and
recorded against a live Orca runtime.

## Remaining Limitations

- The controller expects `.qfoundry/controller-state.json` to be prepared by the
  supervisor or a setup command.
- The review command must print strict JSON; free-form Codex prose is rejected.
- The sidecar does not merge, push, deploy, release, access secrets, or perform
  destructive operations.
- `@codex` group routing is intentionally not used; every lifecycle action uses
  exact task IDs, dispatch IDs, and terminal handles.
