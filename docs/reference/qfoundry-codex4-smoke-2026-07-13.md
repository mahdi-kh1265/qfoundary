# qFoundry Codex-Only Four-Worker Smoke Evidence

Date: 2026-07-13

Verdict: Codex-only four-worker qFoundry fleet verified.

This was a live Orca/qFoundry run against disposable local repositories. It did
not use Antigravity, did not verify or claim Claude, did not push worker output,
and did not modify Orca runtime/UI code.

## Environment

- Orca runtime: running and ready, runtime ID `532ba4ed-f606-4cb7-b846-377167f9d925`.
- Codex CLI: `codex-cli 0.144.0-alpha.4`.
- Controller source base before this evidence commit: `2f5580942`.
- Disposable root: `C:\Users\khams008\Documents\qf-codex4-20260713-123520`.
- Control repo: `<root>\control`.
- Repo A: `<root>\repo-a`.
- Repo B: `<root>\repo-b`.
- Coordinator terminal: `term_b2a21ae0-c0cd-42c6-b454-5eb636585645`.
- Controller settings: provider `codex`, `maxConcurrentWorkers=4`,
  `waitTimeoutMs=120000`, `submitInjectedDispatchEnter=true`.
- Contract status: `approved`; approval attributed to `user`;
  decision record `DEC-C4-001`; approval gate resolved.

## Worker Fleet

| qFoundry task | Orca task | Dispatch | Worker terminal | Repo/worktree | Final qFoundry status |
| --- | --- | --- | --- | --- | --- |
| `QF-C4-001` | `task_939123fa13fe` | `ctx_f48a406bc4e4` | `term_af732495-4ce5-4100-93a8-258ea0922f36` | Repo A, worker 1 | `accepted` after correction |
| `QF-C4-002` | `task_43a861394d50` | `ctx_d3dc900a8989` | `term_966a99a8-a86b-4c2b-8920-0b1f28764ac6` | Repo A, worker 2 | `accepted` |
| `QF-C4-003` | `task_00518f7bc292` | `ctx_3a711f86a2b0` | `term_c2cc4c46-e1be-4c82-befc-eac6f0e35db3` | Repo B, worker 3 | `accepted` |
| `QF-C4-004` | `task_ecd95d159fe4` | `ctx_e9bf11d734ac` | `term_d6428c25-280e-4aa3-86b6-7423900ce4ef` | Repo B, worker 4 | `accepted` |
| `QF-C4-005` | `task_bae27796624e` | `ctx_0d7b7f934983` | `term_c2cc4c46-e1be-4c82-befc-eac6f0e35db3` | Reused worker 3 | `accepted` after correction |

Correction dispatches:

- `QF-C4-001-CORR-001`: Orca task `task_868b9a3f0533`, dispatch
  `ctx_8435d10f7559`, accepted.
- `QF-C4-005-CORR-001`: Orca task `task_fecf3e6da512`, dispatch
  `ctx_3add79a1a0df`, accepted.

## Required Evidence Checklist

- Codex supervisor/controller: observed through local controller invocations
  against `<root>\control\.qfoundry\controller-state.json`.
- Four distinct Codex workers: four worker terminals were created and used for
  `QF-C4-001` through `QF-C4-004`.
- Active model evidence: worker terminal prompts showed `gpt-5.5 xhigh`.
  This is recorded as Codex UI/terminal evidence, not as a separate provider API
  attestation.
- Scoped profile evidence: each worker recorded `windows-codex-compat` profile
  evidence with workspace-write sandbox intent, approval policy `on-request`,
  network disabled, sensitive environment exclusions, and no dangerous bypass
  flags.
- Injected dispatches: controller submitted injected drafts for all initial
  workers and both corrections.
- Valid worker_done: Orca dispatches reached `completed` for each accepted or
  rejected worker attempt before qFoundry verification.
- Independent supervisor tests: deterministic commands were rerun by the
  controller from qFoundry state before acceptance.
- Deliberate worker defects and rejection:
  - `QF-C4-001` deliberately omitted embedded CSV quote doubling; controller
    rejected it after `node --test test/csv.test.mjs` exited 1.
  - `QF-C4-005` initially sent `worker_done` without creating the required
    documentation/report; controller rejected it after
    `node tools/verify-math-contract.mjs` exited 1 with missing
    `docs/math-contract.md`.
- Correction dispatches: both rejected tasks received correction dispatches and
  were accepted only after deterministic verification passed.
- User/auto decision evidence:
  - `QF-C4-002` decision gate was auto-replied with `Use UTC timestamps.`
  - `QF-C4-004` user decision `DEC-001` answered `Use STATUS: STABLE.`
- Dependency release: `QF-C4-005` stayed planned until `QF-C4-003` reached
  qFoundry `accepted`, then reused worker 3.
- Restart/recovery: after the four initial dispatches, the controller was
  restarted and continued from persisted `.qfoundry` state, submitting pending
  injected drafts without re-creating the four initial workers.
- Throttling/capacity observations: Codex worker terminals displayed weekly
  usage warnings below 25% and later below 10%, but no hard rate-limit
  escalation blocked the run.
- Manual interaction: no user click was required for routine worker actions in
  this live pass. Codex automatic approval review did approve several local test
  reruns and lifecycle sends.

## Live Issues Found And Recovered

- The Windows `orca.cmd` shim could not safely serve as the controller process
  command for multiline JSON task specs. A `cmd.exe /c orca.cmd` attempt created
  orphan task `task_5a7229332558` with spec `{`; it was never dispatched and was
  marked blocked/abandoned. Subsequent controller runs used
  `Orca.exe <resources>\app.asar.unpacked\out\cli\index.js` with
  `ELECTRON_RUN_AS_NODE=1`.
- Reused-worker dispatch initially captured `QF-C4-005` against the base repo
  path instead of worker 3's actual worktree. The live state was annotated with
  `live_state_repaired_reused_worker_worktree`, and the controller was patched
  to prefer `worker.worktreePath` for reused worker context packets and
  verification baselines.
- Worker 4's first decision-gate payload lacked task/dispatch IDs. The
  controller recovered it by sender terminal after the decision-gate matching
  hardening, then resumed from persisted qFoundry state.

## Command And Result Ledger

Live command highlights:

- `codex --version`: passed; output `codex-cli 0.144.0-alpha.4`.
- `orca status --json` through direct `Orca.exe` CLI: passed; runtime ready,
  runtime ID `532ba4ed-f606-4cb7-b846-377167f9d925`.
- `qfoundry-controller run ... --provider codex --max-workers 4 --max-steps 1`
  with bare `orca`: failed before state mutation with `spawn orca ENOENT`.
- Same command with `orca.cmd`: failed with Windows `spawn EINVAL`.
- Same command via `cmd.exe /c orca.cmd`: unsafe for multiline specs; created
  orphan `task_5a7229332558`; task was marked blocked/abandoned.
- Same command through `Orca.exe <cli index.js>`: passed for subsequent live
  steps.
- `qfoundry-controller status`: passed; final state shows `QF-C4-001` through
  `QF-C4-005` accepted and no pending decisions.
- Codex JSON reviewer wrapper dry run: passed after using bundled Node; emitted
  strict JSON only.
- Controller Codex reviewer runs: passed; final JSON artifacts were written
  under `<root>\control\.qfoundry\reviewer-runs\codex-review-*`.

Validation commands:

- `pnpm exec vitest run --config config/vitest.config.ts tools/qfoundry-controller/src/controller.test.mjs tools/qfoundry-controller/src/controller-hardening.test.mjs tools/qfoundry-controller/src/controller-worker-profile.test.mjs tools/qfoundry-controller/src/controller-scheduler.test.mjs src/shared/qfoundry-skill-integrity.test.ts`
  - Result: passed, 5 files, 45 tests.
- `pnpm exec oxlint tools/qfoundry-controller/src tools/qfoundry-controller/bin src/shared/qfoundry-skill-integrity.test.ts`
  - Initial result: failed on `max-lines` and one useless length check.
  - Final result after splitting modules/tests and fixing the length check:
    passed with no output.
- `node --check` over changed qFoundry `.mjs` files:
  - Result: passed; output `node --check completed`.
- `pnpm run typecheck:cli`
  - Result: passed.
- `pnpm run typecheck:node`
  - Result: passed.
- `pnpm run build:cli`
  - Result: passed; `out\cli\index.js` verified.
- `git diff --check`
  - Result: passed; only line-ending conversion warnings were printed.
