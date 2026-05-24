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

## Manual smoke harness

Use the manual smoke harness when you want a disposable workspace plus a real OpenCode runtime inside Docker.

```bash
export ANTHROPIC_API_KEY=...
bun run smoke:opencode -- --provider-config ./opencode-provider.jsonc
```

- The script builds local packages, creates a generated workspace under `tmp/opencode-acp/<timestamp>/workspace`, installs local `@depkit/phasekit-*` packages there, and runs `phasekit-install --project`.
- It then starts `ghcr.io/anomalyco/opencode:latest` with `opencode serve` in Docker and calls the HTTP session command API directly.
- The default image changed from the older `ghcr.io/sst/opencode:latest` path after the upstream registry rename; use `--image` only if you need a different tag or mirror.
- `PRD.md` in the generated workspace is copied from `packages/core/tests/fixtures/sample-prd.md`.
- Common provider secret environment variables such as `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are passed through automatically when they are present in the host shell. Use `--env NAME` for any additional variables.
- `--provider-config` points at a host JSON or JSONC file that is mounted into the container and exposed through `OPENCODE_CONFIG`.
- The container only mounts the generated workspace and optional provider config. Local `file:` package dependencies are resolved during host-side workspace generation, not from a repo bind mount.
- Per-command responses are written to `tmp/opencode-acp/<timestamp>/logs/step-N.response.json`, server logs to `logs/server.stdout.log` and `logs/server.stderr.log`, and run metadata to `run-metadata.json`.
- Use `bun run smoke:opencode -- --dry-run` to verify workspace generation and command wiring without starting Docker.
