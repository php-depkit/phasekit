# Configuration

Phasekit configuration is strict JSON. Unknown keys fail validation.

## Sources and precedence

Configuration is resolved in this order:

1. Defaults from `packages/core/src/config/defaults.ts`
2. Global config: `~/.config/phasekit/config.json`
3. Project config: `.planning/config.json`
4. CLI overrides passed to `loadPhasekitConfig()`

The later source wins on a per-field basis.

## Configuration files

| Path | Purpose |
| --- | --- |
| `~/.config/phasekit/config.json` | Machine-wide defaults for the current user |
| `.planning/config.json` | Project-specific overrides and approved verification commands |

`initializePlanningState()` can also write `.planning/config.json` when discovered verification commands are explicitly approved during init.
When `initializePlanningState()` is given `configRoot`, the global config path is resolved under `<configRoot>/phasekit/config.json` instead of the home directory path.

## Supported keys

`packages/core/src/config/schema.ts` defines the allowed shape.

| Key | Default | Notes |
| --- | --- | --- |
| `commit.mode` | `"ask"` | Allowed values: `ask`, `auto`, `off` |
| `commit.planning_commits` | `false` | Enables planning-only commits |
| `quality.review` | `"always"` | Fixed literal in current source |
| `quality.verify` | `"always"` | Fixed literal in current source |
| `greenfield.recommend_stack` | `true` | Controls stack recommendation behavior |
| `greenfield.ask_before_locking_stack` | `true` | Parsed by schema and available to callers |
| `models.*` | See `packages/core/src/config/defaults.ts` | Model IDs for orchestrator, planner, executor, reviewer, verifier, and related roles |
| `verification.commands.test` | unset | Optional explicit command config |
| `verification.commands.typecheck` | unset | Optional explicit command config |
| `verification.commands.lint` | unset | Optional explicit command config |
| `verification.commands.build` | unset | Optional explicit command config |

Each verification command entry accepts:

```json
{
  "command": "bun test",
  "requires_confirmation": true
}
```

`requires_confirmation` defaults to `false` when omitted.

## Validation behavior

- Invalid JSON fails with an `Invalid ...: File must contain valid JSON` error from `loadPhasekitConfig()`.
- Schema violations fail because all config objects are `.strict()`.
- Only `test`, `typecheck`, `lint`, and `build` are valid verification command kinds.

## Where config is consumed

- `packages/core/src/config/loader.ts` resolves and merges config sources.
- `packages/core/src/state/init.ts` discovers verification commands and may persist approved ones into project config.
- `packages/core/src/verify/commands.ts` turns config into executable verification commands.
- `packages/core/src/git/policy.ts` uses commit and quality policy when evaluating commit gates.
- `packages/core/src/verify/execute.ts` uses verification config when running scoped verification.

## Example

```json
{
  "commit": {
    "mode": "ask",
    "planning_commits": false
  },
  "quality": {
    "review": "always",
    "verify": "always"
  },
  "verification": {
    "commands": {
      "test": {
        "command": "bun test"
      },
      "typecheck": {
        "command": "bun run typecheck"
      }
    }
  }
}
```
