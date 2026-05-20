# @depkit/phasekit-opencode

OpenCode plugin adapter for Phasekit. It exposes the native `phasekit_*` tools and installs managed `/pk-*` command and agent artifacts for OpenCode.

## Install

```bash
npm install @depkit/phasekit-opencode
```

## Usage

```ts
import { phasekitOpenCodePlugin } from "@depkit/phasekit-opencode";

export default phasekitOpenCodePlugin;
```

The package includes the managed artifact installer used by `/pk-init`, but does not register slash commands or agents at runtime.
