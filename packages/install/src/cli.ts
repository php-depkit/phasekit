import { defineCommand, runMain } from "citty";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  defaultPhasekitPluginSpec,
  formatInstallSummary,
  formatUninstallSummary,
  installPhasekitOpenCode,
  uninstallPhasekitOpenCode,
} from "./index";

const packageVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

export function createInstallCommand() {
  return defineCommand({
    meta: {
      name: "phasekit-install",
      version: packageVersion,
      description: "Install or uninstall Phasekit OpenCode artifacts.",
    },
    args: {
      project: {
        type: "boolean",
        description: "Install into ./.opencode instead of the global OpenCode config directory.",
      },
      uninstall: {
        type: "boolean",
        description: "Remove managed Phasekit OpenCode config entries and artifacts.",
      },
      force: {
        type: "boolean",
        description: "Overwrite conflicting unmanaged command or agent files during install.",
      },
      plugin: {
        type: "string",
        description: "Plugin spec to add to OpenCode config during install.",
        default: defaultPhasekitPluginSpec,
      },
    },
    async run({ args }) {
      const scopeOptions = args.project ? { projectDir: process.cwd() } : undefined;

      if (args.uninstall) {
        const result = await uninstallPhasekitOpenCode(scopeOptions);
        console.log(formatUninstallSummary(result));
        return;
      }

      const result = await installPhasekitOpenCode({
        ...scopeOptions,
        pluginSpec: args.plugin,
        overwriteUnmanaged: args.force,
      });
      console.log(formatInstallSummary(result));
    },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runMain(createInstallCommand());
}
