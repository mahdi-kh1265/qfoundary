# qFoundary

Personal experimental workspace for the qFoundry Supervisor skill, built on top
of the Orca source tree.

This is not the official Orca README and this repository is not an official Orca
distribution. It currently contains an Orca-based checkout so the
`qfoundry-supervisor` skill can live beside Orca's existing `orca-cli` and
`orchestration` skills and be installed with the same `npx skills add` workflow.

Upstream Orca lives here:

https://github.com/stablyai/orca

## What This Repo Adds

- `skills/qfoundry-supervisor/`: a contract-first supervisor skill for using
  Codex as the qFoundry supervisor over Orca-managed worker agents.
- `skills/qfoundry-supervisor/references/`: project contract, task spec,
  project state, review report, decision log, worker profile, and permission
  policy templates.
- `docs/qfoundry-supervisor.md`: setup, workflow, smoke-test, and maintenance
  notes for the qFoundry MVP.
- `src/shared/qfoundry-skill-integrity.test.ts`: a focused integrity test that
  keeps the skill and its referenced files wired together.

## Install The Skill

Install the base Orca skills from upstream:

```bash
npx skills add https://github.com/stablyai/orca --skill orca-cli --global
npx skills add https://github.com/stablyai/orca --skill orchestration --global
```

Install qFoundry Supervisor from this personal repo:

```bash
npx skills add https://github.com/mahdi-kh1265/qfoundary --skill qfoundry-supervisor --global
```

Restart Codex after installation so the skill is discovered.

## Current Status

MVP implementation is committed on:

- `main`
- `feat/qfoundry-supervisor-mvp`

Validated locally with:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `pnpm vitest run --config config/vitest.config.ts src/shared/qfoundry-skill-integrity.test.ts`
- disposable `npx skills add` install check

The full upstream Orca test suite was not clean on this Windows machine because
the environment is missing repo-wide prerequisites such as `/bin/sh`, `openssl`,
and symlink privileges. The qFoundry-specific test passed.

## Development Notes

This checkout still follows Orca's source layout and toolchain. Use Node 24 and
pnpm when working on it:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm build
```

Keep qFoundry changes additive and isolated under `skills/qfoundry-supervisor`,
`docs/qfoundry-supervisor.md`, and narrowly scoped tests unless there is a clear
reason to change Orca runtime code.

## License And Attribution

The upstream Orca code in this repository remains under its original license.
See `LICENSE` and the upstream project for the authoritative source and project
history.
