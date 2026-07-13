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

Use Manual agent permissions for qFoundry projects unless the approved contract
names a narrower exception. Do not recommend global permission bypass as the
default operating mode.
