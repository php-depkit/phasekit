import type {
  VerificationCommandConfig,
  VerificationCommandKind,
  VerificationConfig,
} from "../config/schema";

export const verificationCommandKinds = ["test", "typecheck", "lint", "build"] as const;

export type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

export interface PackageMetadataInput {
  packageManager: PackageManager;
  scripts: Record<string, string>;
}

export type VerificationCommandSource = "configured" | "discovered";

export interface VerificationCommand {
  kind: VerificationCommandKind;
  command: string;
  source: VerificationCommandSource;
  requires_confirmation: boolean;
  confirmation_reasons: string[];
}

export interface DiscoverVerificationCommandsOptions {
  config?: VerificationConfig;
  packageMetadata?: PackageMetadataInput[];
}

interface DiscoveredScript {
  kind: VerificationCommandKind;
  command: string;
  scriptName: string;
  scriptBody: string;
  ambiguous: boolean;
}

const unsafeScriptPattern = /[;&|`$<>\n\r]/;

function configuredCommand(
  kind: VerificationCommandKind,
  config: VerificationCommandConfig,
): VerificationCommand {
  return {
    kind,
    command: config.command,
    source: "configured",
    requires_confirmation: config.requires_confirmation ?? false,
    confirmation_reasons: config.requires_confirmation ? ["configured command requires confirmation"] : [],
  };
}

function commandForScript(packageManager: PackageManager, scriptName: string): string {
  return `${packageManager} run ${scriptName}`;
}

function scriptCandidates(kind: VerificationCommandKind, scripts: Record<string, string>): string[] {
  return Object.keys(scripts)
    .filter((scriptName) => scriptName === kind || scriptName.startsWith(`${kind}:`))
    .sort((left, right) => left.localeCompare(right));
}

function discoverScript(
  kind: VerificationCommandKind,
  packageMetadata: PackageMetadataInput[],
): DiscoveredScript | undefined {
  const candidates = packageMetadata.flatMap((metadata) =>
    scriptCandidates(kind, metadata.scripts).map((scriptName) => ({
      command: commandForScript(metadata.packageManager, scriptName),
      scriptName,
        scriptBody: metadata.scripts[scriptName] ?? "",
      })),
  ).sort((left, right) => {
    const commandOrder = left.command.localeCompare(right.command);

    if (commandOrder !== 0) {
      return commandOrder;
    }

    const scriptNameOrder = left.scriptName.localeCompare(right.scriptName);

    if (scriptNameOrder !== 0) {
      return scriptNameOrder;
    }

    return left.scriptBody.localeCompare(right.scriptBody);
  });

  if (candidates.length === 0) {
    return undefined;
  }

  const exactCandidate = candidates.find((candidate) => candidate.scriptName === kind);
  const selected = exactCandidate ?? candidates[0];

  if (!selected) {
    return undefined;
  }

  return {
    kind,
    ...selected,
    ambiguous: candidates.length > 1 || selected.scriptName !== kind,
  };
}

function discoveredCommand(discovered: DiscoveredScript): VerificationCommand {
  const confirmation_reasons: string[] = [];

  if (discovered.ambiguous) {
    confirmation_reasons.push("discovered command is ambiguous");
  }

  if (unsafeScriptPattern.test(discovered.scriptBody)) {
    confirmation_reasons.push("discovered package script contains shell control syntax");
  }

  if (unsafeScriptPattern.test(discovered.command)) {
    confirmation_reasons.push("discovered command contains shell control syntax");
  }

  return {
    kind: discovered.kind,
    command: discovered.command,
    source: "discovered",
    requires_confirmation: confirmation_reasons.length > 0,
    confirmation_reasons,
  };
}

export function discoverVerificationCommands(
  options: DiscoverVerificationCommandsOptions = {},
): VerificationCommand[] {
  const packageMetadata = options.packageMetadata ?? [];

  return verificationCommandKinds.flatMap((kind) => {
    const configured = options.config?.commands[kind];

    if (configured) {
      return [configuredCommand(kind, configured)];
    }

    const discovered = discoverScript(kind, packageMetadata);

    return discovered ? [discoveredCommand(discovered)] : [];
  });
}
