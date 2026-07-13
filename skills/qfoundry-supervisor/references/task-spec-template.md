# qFoundry Task Specification

qFoundry task ID: `QF-TASK-001`
Task title: `[TITLE]`
Objective: `[ONE SENTENCE OBJECTIVE]`
Owner: `[worker role]`
Orca task ID: `[filled after task-create]`
Dispatch ID: `[filled after dispatch]`

## Related Contract IDs

- Requirements: `[REQ-001]`
- Acceptance criteria: `[AC-001]`

## Repository Context

- Relevant files: `[paths]`
- Relevant docs: `[paths]`
- Observed constraints: `[facts]`
- Assumptions: `[assumptions]`

## Likely Affected Subsystem

`[subsystem]`

## Permitted Edit Scope

- `[allowed file or subsystem]`

## Constraints

- `[constraint]`

## Prohibited Actions

- Do not edit files outside the permitted scope without asking.
- Do not change dependencies, CI, public interfaces, secrets, or security
  behavior unless this task explicitly permits it.
- Do not merge, push, deploy, publish, spend money, delete valuable data, or
  send external communications.

## Dependencies

- `[task IDs or none]`

## Required Tests

- `[command or targeted validation]`

## Required Documentation

- `[docs updates or none]`

## Expected Evidence

- Complete worker report path.
- Files modified and added.
- Commands run and test output.
- Deviations, assumptions, unresolved issues, and risks.

## Worker Completion Report Requirements

Send exactly one `worker_done` from the worker terminal after writing the report.
The report must include task ID, dispatch ID, worker identity, verifiable model
name when available, files changed, commands run, test results, assumptions,
deviations, unresolved issues, risks, and recommended follow-up.

## Correction History

| Correction | Reason | Status |
| --- | --- | --- |
| `[none]` | `[none]` | `[none]` |
