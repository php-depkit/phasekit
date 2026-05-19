# Contributing

## Development Setup

1. Install Bun `1.3.14`.
2. Run `bun install --frozen-lockfile`.
3. Run `bun test`, `bun run typecheck`, and `bun run lint` before submitting changes.

## Change Scope

- Prefer the smallest correct change.
- Keep `@phasekit/core` harness-agnostic.
- Do not introduce runtime behavior into generated markdown artifacts.
- Preserve the existing Bun workspace and package boundaries.

## Pull Requests

- Use clear commit messages so `release-please` can generate accurate changelog entries.
- Include tests or targeted verification when behavior changes.
- Update nearby docs when setup, commands, or release behavior changes.

## Reviews

- Prioritize correctness, regressions, and scope drift.
- Call out skipped verification explicitly.
