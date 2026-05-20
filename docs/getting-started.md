# Getting started

## Prerequisites

- Bun `1.3.14` (`package.json` and CI both pin this version).
- OpenCode, if you want to use the generated `/pk-*` command flow.

## Install

From the repository root:

```bash
bun install --frozen-lockfile
```

The repo enforces Bun with `bunx only-allow bun` during install.

## Verify the workspace

```bash
bun test
bun run typecheck
bun run lint
```

These are the same checks used in CI (`.github/workflows/ci.yaml`).

## First successful run

Phasekit is driven through OpenCode. The normal first step is:

1. Run `/pk-init` in OpenCode.
2. Inspect the generated `.planning/` state.
3. Use `/pk-status` and `/pk-next` to see what Phasekit thinks should happen next.

Typical follow-up workflow:

```text
/pk-ingest <path...>
/pk-add-phase <goal>
/pk-run-phase <phase-id>
/pk-verify <scope>
```

## Common next steps

- Read [Configuration](./configuration.md) to adjust verification commands or policy defaults.
- Read [Data model](./data-model.md) to understand the files created under `.planning/`.
- Read [API reference](./api.md) if you are embedding Phasekit in code.
