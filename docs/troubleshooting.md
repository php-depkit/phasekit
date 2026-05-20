# Troubleshooting

## `Incomplete Phasekit state: .planning/<file> is missing.`

**Likely cause:** `.planning/project.json`, `.planning/requirements.json`, or `.planning/phases.json` was not initialized or was deleted.

**Fix:** run `/pk-init` again and let Phasekit recreate the canonical state.

**Relevant source:** `packages/core/src/status/index.ts`, `packages/core/src/state/init.ts`.

## `Invalid global config` / `Invalid project config`

**Likely cause:** `~/.config/phasekit/config.json` or `.planning/config.json` is malformed JSON or fails the strict schema.

**Fix:** correct the file, keeping only supported keys from [Configuration](./configuration.md).

**Relevant source:** `packages/core/src/config/loader.ts`, `packages/core/src/config/schema.ts`.

## `Cannot determine status: multiple active runs exist (...)`

**Likely cause:** more than one non-complete file exists under `.planning/runs/`.

**Fix:** complete or remove the duplicate run records before asking for status again.

**Relevant source:** `packages/core/src/status/index.ts`, `packages/core/src/runs/persistence.ts`.

## `Cannot create run: phase ... was not found` / `is already complete` / `is blocked`

**Likely cause:** the requested phase ID does not exist, or the phase cannot legally start.

**Fix:** check `.planning/phases.json` and make sure the phase is pending or in progress.

**Relevant source:** `packages/core/src/runs/persistence.ts`.

## `Unsafe run id ...`

**Likely cause:** a run file name is not safe to store directly under `.planning/runs/`.

**Fix:** do not rename run IDs manually; let Phasekit create them.

**Relevant source:** `packages/core/src/runs/persistence.ts`.

## `Refusing to overwrite unmanaged OpenCode ... artifact`

**Likely cause:** a generated command or agent file exists, but it does not start with the Phasekit managed marker.

**Fix:** restore the managed file or remove the unmanaged file before rerunning `/pk-init`.

**Relevant source:** `packages/install/src/index.ts`, `packages/core/src/artifacts/write.ts`.

## Verification is blocked

**Symptoms:** scoped verification reports missing approvals or failed checks.

**Likely cause:** discovered checks were not explicitly approved, or one of the approved checks failed.

**Fix:** approve the missing checks in config when appropriate, then rerun `/pk-verify <scope>` after fixing failures.

**Relevant source:** `packages/core/src/verify/execute.ts`, `packages/core/src/verify/commands.ts`.

## Need more context

If a failure is not covered here, inspect:

- `.planning/project.json`
- `.planning/config.json`
- `.planning/phases.json`
- `.planning/runs/*.json`
- `.planning/verifications/*.json`

Those files are the canonical source of truth for Phasekit state.

### Quick diagnostics

```text
/pk-status
/pk-next
/pk-init
/pk-verify <scope>
```

For repository-level verification, also run:

```bash
bun test
bun run typecheck
bun run lint
```
