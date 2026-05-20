# @depkit/phasekit-core

Harness-agnostic Phasekit core for deterministic `.planning` state, ingestion, run orchestration, verification, and artifact generation.

## Install

```bash
npm install @depkit/phasekit-core
```

## Usage

```ts
import { getStatus, initializePlanningState } from "@depkit/phasekit-core";

await initializePlanningState(process.cwd());
const status = await getStatus({ rootDir: process.cwd() });
```

`@depkit/phasekit-core` stays harness-agnostic. OpenCode-specific plugin wiring lives in `@depkit/phasekit-opencode`.
