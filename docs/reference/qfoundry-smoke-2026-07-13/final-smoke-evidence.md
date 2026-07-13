# qFoundry Four-Worker Connectivity Smoke Evidence

Report timestamp: `2026-07-13T06:18:30Z`
Supervisor: `Codex`
Overall result: `partial pass / blocked limitation`

## Supervisor

- Supervisor worktree: `9ee5d578-5d11-47bd-a7e5-14b336150bb9::C:/Users/khams008/orca/workspaces/qfoundry-orca-smoke-20260713-003427/qf-smoke-supervisor-manual`
- Supervisor terminal handle: `term_b0c1ed8d-39fc-4988-8af2-fcd9ff7c4e7b`
- Orca runtime ID: `532ba4ed-f606-4cb7-b846-377167f9d925`

## Worker Matrix

| Worker | Worktree | Terminal handle | Task ID | Dispatch ID | Nonce | Artifact | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `worker-1` | `qf-smoke-w1-66eb12` | `term_44d94a01-099d-4824-a4b5-47787da5576e` | `task_173b67f8406f` | `ctx_95a02ffdfe3b` | `qf-1-66eb12ac8f284e4a` | `artifacts/worker-1.txt` | `accepted` |
| `worker-2` | `qf-smoke-w2-0af69b` | `term_7dadd70f-05e0-4059-be27-65c6f4328c2b` | `task_73b6779de430` | `ctx_130192a804e4` | `qf-2-0af69bd244184edb` | `artifacts/worker-2.txt` | `accepted` |
| `worker-3` | `qf-smoke-w3-347b89` | `term_c19b96df-5532-4cfb-9cf2-e0ddecbfb3a5` | `task_de3579316196` | `ctx_57002506f362` | `qf-3-347b89cd86e442f4` | `artifacts/worker-3.txt` | `accepted` |
| `worker-4` | `qf-smoke-w4-1f5e5c` | `term_e6082cb3-1935-4c0a-a759-1ec1b4143561` | `task_f7b4af0b23b8` | `ctx_43599dd8a1c1` | `qf-4-1f5e5cebe14647da` | `artifacts/worker-4.txt` | `accepted` |

## Worker Done Evidence

| Worker | Message ID | Created at | Payload match |
| --- | --- | --- | --- |
| `worker-1` | `msg_4756355f14c3` | `2026-07-13 06:12:40` | `task_173b67f8406f` / `ctx_95a02ffdfe3b` |
| `worker-2` | `msg_412a3babfd7d` | `2026-07-13 06:13:33` | `task_73b6779de430` / `ctx_130192a804e4` |
| `worker-3` | `msg_5d75e8620fbb` | `2026-07-13 06:12:03` | `task_de3579316196` / `ctx_57002506f362` |
| `worker-4` | `msg_70d5f5fcf4fd` | `2026-07-13 06:15:57` | `task_f7b4af0b23b8` / `ctx_43599dd8a1c1` |

`orca orchestration check --all --types worker_done --json` returned exactly four worker_done messages for the four active dispatches. `orca orchestration dispatch-show --task <task_id> --json` showed all four dispatches completed with `failure_count=0`.

## qFoundry Status Transitions

Each active worker task followed this qFoundry path:

`planned -> dispatched -> worker_completed -> under_verification -> accepted`

Preliminary task records `task_92ea227724e3`, `task_ad8c0e670537`, `task_d18d7dbe976c`, and `task_f2e7bd589698` were blocked/superseded before dispatch because multiline specs appeared truncated in `task-list`. No worker was dispatched on those records.

## Artifact Verification

All four artifacts were independently read from their worker worktrees with `ReadAllBytes`. Each artifact was exactly 22 bytes, contained its assigned nonce plus byte `0x0A`, had no CR byte, and had no UTF-8 BOM.

Git status for each worker showed only the assigned untracked artifact. `git diff --check`, tracked diff, and cached diff were empty. `git diff --no-index -- /dev/null <artifact>` showed the single expected added line for each artifact and emitted only the Windows Git line-ending warning that LF may become CRLF if Git touches the file later.

## Direct And Group Message Evidence

- Direct status nonce: `qf-msg-direct-e3d43065fa384807`
- Direct message ID: `msg_8802ab5cf54b`
- Direct message target: worker-1 `term_44d94a01-099d-4824-a4b5-47787da5576e`
- Direct verification: worker-1 inbox contained the direct nonce; workers 2, 3, and 4 returned zero status messages and did not contain the direct nonce.
- Group status nonce: `qf-msg-group-37c5bcaa0ee34838`
- Group result: failed twice. `orca orchestration send --to '@codex'` returned `No recipients resolved for group address: @codex` before dispatch and again after worker completion.
- Runtime note: this CLI does not support `orca orchestration check --peek`; `--all` was used for non-consuming evidence checks.

The direct message test passed. The required `@codex` group message test did not pass because the runtime did not resolve any recipients for `@codex`.

## Rate Limit And Process Observations

- `orca open --json` required escalation before the local Orca runtime became reachable from this environment.
- Sandboxed Orca RPC calls reported `runtime_unavailable`; escalated Orca CLI calls reached runtime `532ba4ed-f606-4cb7-b846-377167f9d925`.
- The exact rolling wait command was used: `orca orchestration check --wait --types worker_done,escalation,decision_gate --timeout-ms 900000 --json`.
- First worker_done arrived after a long wait window; later completions arrived in subsequent rolling waits.
- No manual permission approval prompt was observed by the supervisor.
- Codex model identity for workers was not independently verified; reports record model as `unverified` where applicable.

## Failures Or Limitations

- `AC-010` failed/blocked: `@codex` group status routing returned no recipients even though Codex worker terminals existed and were usable for direct dispatch.
- The first four preliminary task records were superseded before dispatch due multiline task spec visibility/truncation; four corrected single-line task records were used for active dispatch.
- `check --peek` is unavailable in this Orca CLI/runtime, so `check --all` was used.
- The patch tool failed with a Windows sandbox wrapper error after initial file creation; qFoundry state/report updates were written with PowerShell as a scoped fallback.
- Git emitted LF-to-CRLF warnings for the untracked artifact files; current on-disk bytes were independently verified as LF-only.

## Prohibited Action Check

No merge, push, deploy, publish, delete, secret access, external communication, or `orca orchestration reset` was performed. Disposable worker worktrees were left available for inspection.
