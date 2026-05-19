# Phasekit

Phasekit is an OpenCode-first planning and execution plugin with a harness-agnostic core. It ingests product intent, turns it into small phases, coordinates focused agent work, and keeps committed `.planning` state as the source of truth.

## Status

This repository is a Bun-powered TypeScript workspace. It is set up for open source collaboration and GitHub Releases, but it is not currently configured for npm publishing because the workspace packages remain `private`.

## Workspace

- `packages/core`: harness-agnostic planning, orchestration, verification, and artifact logic.
- `packages/opencode`: OpenCode plugin adapter that exposes native `phasekit_*` tools.
- `packages/install`: deterministic installer for managed OpenCode command and agent markdown artifacts.

## Requirements

- Bun `1.3.14`
- OpenCode for the plugin and generated `/pk-*` command flow

## Setup

```bash
bun install --frozen-lockfile
```

The repo enforces Bun as its package manager with `bunx only-allow bun` during install.

## Development

```bash
bun test
bun run typecheck
bun run lint
```

## Usage

Phasekit is designed to be driven through its OpenCode integration.

1. Initialize planning state with `/pk-init`.
2. Ingest product input with `/pk-ingest <path...>`.
3. Inspect progress with `/pk-status` or `/pk-next`.
4. Execute one approved phase with `/pk-run-phase <phase-id>`.
5. Run scoped verification with `/pk-verify <scope>`.

The native execution surface lives in `@phasekit/opencode`; generated markdown commands remain thin wrappers around those tools.

## Releases

GitHub release automation is managed with `release-please`.

- pushes to `main` or `master` run CI and release automation
- release tags use the `vX.X.X` format
- release creation is GitHub-only today; no npm, Homebrew, Docker, or binary publishing is configured

## Contributing

See `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` for contribution and reporting guidance.

## License

MIT
