export const installPackageName = "@phasekit/install" as const;

export function describeInstallPackage(): { name: typeof installPackageName } {
  return { name: installPackageName };
}
