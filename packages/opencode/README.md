# @depkit/phasekit-opencode

OpenCode plugin adapter for Phasekit. It exposes the native `phasekit_*` tools for OpenCode.

## Install

```bash
npm install @depkit/phasekit-opencode
```

## Usage

```ts
import phasekitOpenCodePlugin from "@depkit/phasekit-opencode";

export default phasekitOpenCodePlugin;
```

The plugin does not install slash commands or agents at runtime. Run the managed artifact installer explicitly when command or agent files need to be created or updated.

When adding the plugin to OpenCode config, use `@depkit/phasekit-opencode` as the plugin spec.

The package root default export is an OpenCode `PluginModule` object with a `server()` hook, and the package also exposes a dedicated `./server` target for OpenCode's server-plugin resolution.

Use `@depkit/phasekit-opencode/adapter` only when you need the adapter helper exports directly.

When project-local `.opencode/commands` or `.opencode/agents` already contain conflicting user-owned files, the installer will fail safely by default. Use the installer `--force` option only when you intentionally want Phasekit to replace those files.
