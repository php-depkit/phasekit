# Phasekit

Phasekit is an OpenCode-first planning and execution plugin with a harness-agnostic core. It ingests product intent, turns it into small phases, coordinates focused agent work, and keeps committed `.planning` state as the source of truth.

## Status

This repository is a Bun-powered TypeScript workspace. It is set up for open source collaboration, GitHub Releases, and npm packaging for the public `@depkit/phasekit-core` and `@depkit/phasekit-opencode` packages.

## Workspace

- `packages/core`: harness-agnostic planning, orchestration, verification, and artifact logic published as `@depkit/phasekit-core`.
- `packages/opencode`: OpenCode plugin adapter published as `@depkit/phasekit-opencode`.
- `packages/install`: internal workspace package that re-exports the managed OpenCode artifact installer used by `packages/opencode`.

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

The native execution surface lives in `@depkit/phasekit-opencode`; generated markdown commands remain thin wrappers around those tools.

## Releases

GitHub release automation is managed with `release-please`.

- pushes to `main` or `master` run CI and release automation
- release tags use the `vX.X.X` format
- package tags are generated per public npm package
- package tarballs can be validated locally with `npm pack ./packages/core` and `npm pack ./packages/opencode`
- GitHub Actions publishes `@depkit/phasekit-core` before `@depkit/phasekit-opencode`
- configure npm trusted publishers for both public packages against `.github/workflows/release.yaml`
- publish jobs use `npm publish --provenance --access public`
- publish jobs skip package versions that already exist on npm

## Contributing

See `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` for contribution and reporting guidance.

## License

MIT
