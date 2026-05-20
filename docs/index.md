# Phasekit documentation

Phasekit is an OpenCode-first planning and execution plugin with a harness-agnostic core. The repository is Bun-based TypeScript, publishes `@depkit/phasekit-core` and `@depkit/phasekit-opencode`, and keeps canonical state in committed `.planning` JSON files.

## What this docs set covers

- How to install and verify the workspace.
- How Phasekit configuration is resolved.
- What lives in `.planning/` and how it is used.
- The main public API and OpenCode integration surface.
- Common failure modes and how to diagnose them.

## Start here

1. [Getting started](./getting-started.md)
2. [Configuration](./configuration.md)
3. [API reference](./api.md)
4. [Data model](./data-model.md)
5. [Development](./development.md)
6. [Troubleshooting](./troubleshooting.md)

## Recommended path

- New users: read [Getting started](./getting-started.md), then [Configuration](./configuration.md).
- Maintainers: read [Development](./development.md) and [API reference](./api.md).
- When something fails: jump to [Troubleshooting](./troubleshooting.md).

## Current limitations

- v1 is OpenCode-only; there is no standalone CLI entrypoint.
- Generated `/pk-*` commands are markdown wrappers around native plugin tools.
- No repo-defined environment variables are documented in source; configuration is file- and API-driven.
