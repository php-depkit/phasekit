export const corePackageName = "@phasekit/core" as const;

export function describeCorePackage(): { name: typeof corePackageName } {
  return { name: corePackageName };
}
