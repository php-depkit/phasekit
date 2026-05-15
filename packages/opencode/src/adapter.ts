import { describeCorePackage } from "@phasekit/core";

export const opencodePackageName = "@phasekit/opencode" as const;

export function describeOpenCodeAdapter(): {
  name: typeof opencodePackageName;
  core: ReturnType<typeof describeCorePackage>;
} {
  return {
    name: opencodePackageName,
    core: describeCorePackage(),
  };
}
