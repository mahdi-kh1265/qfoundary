# qFoundry Worker Profiles

## Codex Supervisor

Responsibilities:

- project discovery
- contract creation
- task decomposition
- worker selection
- Orca task and dispatch tracking
- progress monitoring
- diff inspection
- independent testing
- rejection and correction routing
- human escalation
- integration recommendation

The supervisor owns acceptance decisions. It does not treat worker completion
as acceptance.

## Codex Implementation Worker

Use Codex as the default MVP implementation worker. Each worker runs in a
separate Orca terminal with a concrete handle and an assigned repository
worktree.

Responsibilities:

- work in the assigned Orca worktree or terminal
- implement the tracked qFoundry task only
- run required tests
- write the completion report
- send exactly one `worker_done` from its own terminal

Identity and profile handling:

- Record the Orca terminal handle, qFoundry task ID, Orca task ID, and dispatch
  ID in the worker report.
- Use the preferred granular permission profile when supported by the installed
  Codex version.
- Use `windows-codex-compat` when the preferred permission-profile backend is
  blocked or unavailable on Windows.
- Record workspace-write sandbox mode, approval policy, automatic boundary
  review, network-disabled status, effective worktree directory,
  authenticated Codex home use, sensitive environment exclusions, absence of
  dangerous bypass flags, and filesystem granularity.
- Never print or copy Codex credentials.
- Never use Yolo, full-access, or sandbox-bypass modes for qFoundry workers.

## Future Adapter Worker

Use this profile only when a later approved contract adds another supported TUI
agent:

- verify its agent id, launch command, readiness behavior, and prompt mechanism
- use Orca tracked tasks and dispatches for supervised work
- keep edits inside the permitted scope
- report files, commands, tests, assumptions, and risks
- send lifecycle messages only from the assigned terminal
- verify provider and model attribution before naming either in evidence

## Independent Review Worker

Use a review worker only when independence is useful:

- inspect the worker diff
- run or recommend targeted tests
- identify missed requirements, edge cases, and security issues
- report findings through a tracked review task
- avoid implementing fixes unless explicitly assigned

Review worker completion is advisory. The supervisor still owns acceptance.
