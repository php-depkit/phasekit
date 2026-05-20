# Development

## Repository layout

- `packages/core`: harness-agnostic planning, orchestration, verification, and artifact logic.
- `packages/opencode`: OpenCode plugin adapter and generated artifact installer.
- `packages/install`: explicit installer CLI and helper package for managed OpenCode artifacts.

## Common commands

From the repository root:

```bash
bun install --frozen-lockfile
bun test
bun run typecheck
bun run lint
bun run build
bun run release:build
bun run release:publish:dry-run
```

`bun run build` uses `tsup` to build `packages/core`, `packages/opencode`, and `packages/install` into `dist/`.

## Packaging and release

- Each public package publishes from its `dist/` directory and runs `bun run build` in `prepack`.
- `bun run release:publish` publishes `@depkit/phasekit-core`, then `@depkit/phasekit-opencode`, then `@depkit/phasekit-install`, skipping versions that already exist on npm.
- Releases are managed by `release-please` using `release-please-config.json` and `.github/workflows/release.yaml`.
- CI runs install, lint, typecheck, and tests on pushes and pull requests to `main` and `master`.

## Notes for maintainers

- Keep generated `/pk-*` commands thin; their job is to call native plugin tools.
- Canonical state lives in `.planning/*.json`.
- The repo is Bun-first; the root package enforces Bun during install.
