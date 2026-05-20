# Data model

Phasekit persists its source of truth under `.planning/`.

## Files

| File | Purpose | Schema source |
| --- | --- | --- |
| `.planning/project.json` | Project-level state such as the confirmed stack | `packages/core/src/state/schema.ts` |
| `.planning/config.json` | Project config overrides and approved verification commands | `packages/core/src/config/schema.ts` |
| `.planning/requirements.json` | Canonical requirements | `packages/core/src/state/schema.ts` |
| `.planning/phases.json` | Phase plan and phase status | `packages/core/src/state/schema.ts` |
| `.planning/rules.json` | Canonical project rules | `packages/core/src/state/schema.ts` |
| `.planning/runs/<run-id>.json` | Run state for a phase | `packages/core/src/state/schema.ts`, `packages/core/src/runs/persistence.ts` |
| `.planning/verifications/<scope-id>.json` | Scoped verification result | `packages/core/src/verify/execute.ts` |

## Defaults

The init defaults are empty structures:

- project: `{}`
- requirements: `{ "requirements": [] }`
- phases: `{ "phases": [] }`
- rules: `{ "rules": [] }`

See `packages/core/src/state/defaults.ts`.

## Run stages

Runs move through a fixed sequence in `packages/core/src/runs/lifecycle.ts`:

`created` → `context` → `planning` → `execution` → `review` → `verification` → `complete`

## Manual edits

Manual edits to `.planning` are possible, but the schemas are strict and many operations validate file contents before continuing. If you edit these files by hand, keep the structure exact and avoid extra keys.
