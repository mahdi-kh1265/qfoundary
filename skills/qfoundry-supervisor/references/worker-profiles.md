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

## Antigravity Worker

Current Orca source facts to verify before use:

- Canonical Orca agent id: `antigravity`
- Detected executable: `agy`
- Launch command: `agy`
- Prompt mode in source: `--prompt-interactive`
- Resume command when a conversation ID is known: `agy --conversation <conversationId>`
- Hook config path in current source: `~/.gemini/config/hooks.json`
- Antigravity hook source extracts `conversationId` when available.

Responsibilities:

- work in the assigned Orca worktree or terminal
- implement the tracked qFoundry task only
- run required tests
- write the completion report
- send exactly one `worker_done` from its own terminal

Model handling:

- Use a Claude model only when the installed Antigravity session supports it.
- Verify the active model from visible Antigravity state, source-confirmed
  runtime metadata, or explicit user confirmation.
- If verification is impossible, record `model: unverified`.
- Never claim Claude completed the task when model identity is unverified.

## Generic Orca Worker

Use this profile for any other supported TUI agent:

- verify its agent id, launch command, readiness behavior, and prompt mechanism
- use Orca tracked tasks and dispatches for supervised work
- keep edits inside the permitted scope
- report files, commands, tests, assumptions, and risks
- send lifecycle messages only from the assigned terminal

## Independent Review Worker

Use a review worker only when independence is useful:

- inspect the worker diff
- run or recommend targeted tests
- identify missed requirements, edge cases, and security issues
- report findings through a tracked review task
- avoid implementing fixes unless explicitly assigned

Review worker completion is advisory. The supervisor still owns acceptance.
