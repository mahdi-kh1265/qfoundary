# qFoundry Permission Policy

This policy applies to projects supervised with qFoundry. The current
implementation branch for the qFoundry skill may have separate user-approved
Git operations, but project work supervised by qFoundry follows this runtime
policy.

## Green: Supervisor May Proceed

- Inspect repository files.
- Inspect Git history and diffs.
- Edit files in an explicitly assigned development worktree.
- Run local tests, lint, type checking, and local builds.
- Create local feature branches.
- Create disposable worktrees.
- Write `.qfoundry/` state and reports.
- Inspect worker completion reports.
- Inspect Orca task, dispatch, and terminal state.

## Yellow: Notify Or Obtain Approval According To Contract

- Add or upgrade dependencies.
- Run a broad architecture refactor.
- Modify database schema.
- Modify CI configuration.
- Access an external development service.
- Consume substantial paid API usage.
- Modify build tooling.
- Alter authentication or authorization behavior.
- Alter public interfaces.

## Red: Explicit User Approval Required

- Merge into a primary or protected branch.
- Push project implementation branches.
- Publish a release.
- Deploy.
- Spend money.
- Expose, retrieve, or print secrets unnecessarily.
- Send email or external messages.
- Submit external forms.
- Delete valuable data.
- Modify production.
- Disable or weaken security controls.
- Weaken tests to make them pass.
- Enable broad permission bypass modes.
- Execute destructive system administration.

## Permission Defaults

Use scoped Codex worker permissions for qFoundry projects unless the approved
contract names a narrower exception. Do not recommend global permission bypass
as the default operating mode.

For Phase 2A Codex workers, prefer the scoped permission-profile example in
`tools/qfoundry-controller/profiles/codex-worker.permissions.config.toml` when
the installed Codex version supports permission profiles. Use
`windows-codex-compat`, backed by
`tools/qfoundry-controller/profiles/codex-worker.compat.config.toml`, as the
documented `workspace-write` / `on-request` compatibility fallback.

The `windows-codex-compat` preflight must record workspace-write sandbox mode,
approval policy, automatic boundary review configuration, network-disabled
status, effective worktree directory, authenticated Codex home use, sensitive
environment exclusions, absence of dangerous bypass flags, and filesystem
granularity. It is suitable for controlled personal development when the
preferred profile backend is blocked, but it has weaker filesystem granularity
than the preferred profile.

Codex automatic approval review handles low-level sandbox boundary requests;
qFoundry supervisor acceptance remains a separate verification verdict.
