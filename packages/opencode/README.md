# @depkit/phasekit-opencode

OpenCode plugin adapter for Phasekit. It exposes the native `phasekit_*` tools for OpenCode.

## Install

```bash
npm install @depkit/phasekit-opencode
```

## Usage

```ts
import phasekitOpenCodePlugin from "@depkit/phasekit-opencode/plugin";

export default phasekitOpenCodePlugin;
```

The plugin does not install slash commands or agents at runtime. Run the managed artifact installer explicitly when command or agent files need to be created or updated.

When project-local `.opencode/commands` or `.opencode/agents` already contain conflicting user-owned files, the installer will fail safely by default. Use the installer `--force` option only when you intentionally want Phasekit to replace those files.
