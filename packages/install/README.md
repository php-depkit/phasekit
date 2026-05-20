# @depkit/phasekit-install

Explicit installer CLI and helpers for Phasekit OpenCode integration.

This package is the user-facing install path for OpenCode setup.

## CLI

```bash
phasekit-install
phasekit-install --project
phasekit-install --project --force
phasekit-install --uninstall
npx @depkit/phasekit-install --project
```

Use `--force` only when you explicitly want Phasekit to overwrite conflicting unmanaged `pk-*` command or agent files.

## API

- `installPhasekitOpenCode()`
- `uninstallPhasekitOpenCode()`
- `installOpenCodeBootstrapArtifacts()`
