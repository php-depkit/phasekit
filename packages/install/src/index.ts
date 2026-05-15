import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const installPackageName = "@phasekit/install" as const;

const managedMarker = "<!-- phasekit:managed opencode-command v1 -->";

export type OpenCodeCommandName = "pk-init" | "pk-status" | "pk-next" | "pk-config";

export type OpenCodeCommandArtifact = {
  name: OpenCodeCommandName;
  path: string;
  content: string;
};

export type InstallOpenCodeCommandArtifactsOptions = {
  homeDir?: string;
  configRoot?: string;
};

export type InstallOpenCodeCommandArtifactsResult = {
  commandsDir: string;
  artifacts: OpenCodeCommandArtifact[];
};

export function describeInstallPackage(): { name: typeof installPackageName } {
  return { name: installPackageName };
}

export function getOpenCodeCommandsDir(options: InstallOpenCodeCommandArtifactsOptions = {}): string {
  return join(options.configRoot ?? join(options.homeDir ?? homedir(), ".config"), "opencode", "commands");
}

export function generateOpenCodeCommandArtifacts(
  options: InstallOpenCodeCommandArtifactsOptions = {},
): OpenCodeCommandArtifact[] {
  const commandsDir = getOpenCodeCommandsDir(options);

  return commandTemplates.map((template) => ({
    name: template.name,
    path: join(commandsDir, `${template.name}.md`),
    content: renderCommand(template),
  }));
}

export async function installOpenCodeCommandArtifacts(
  options: InstallOpenCodeCommandArtifactsOptions = {},
): Promise<InstallOpenCodeCommandArtifactsResult> {
  const commandsDir = getOpenCodeCommandsDir(options);
  const artifacts = generateOpenCodeCommandArtifacts(options);

  await mkdir(commandsDir, { recursive: true });

  for (const artifact of artifacts) {
    await assertManagedOrMissing(artifact.path);
    await writeFile(artifact.path, artifact.content, "utf8");
  }

  return { commandsDir, artifacts };
}

type CommandTemplate = {
  name: OpenCodeCommandName;
  description: string;
  body: string[];
};

const commandTemplates: CommandTemplate[] = [
  {
    name: "pk-init",
    description: "Initialize Phasekit state for this workspace.",
    body: [
      "Call the `phasekit_init_project` tool for the current workspace root.",
      "Return the tool result directly and do not create or edit `.planning` files from this command markdown.",
    ],
  },
  {
    name: "pk-status",
    description: "Show current Phasekit status.",
    body: [
      "Call the `phasekit_get_status` tool for the current workspace root.",
      "Return the tool result directly and do not infer status from files or chat history.",
    ],
  },
  {
    name: "pk-next",
    description: "Show the next valid Phasekit action.",
    body: [
      "Call the `phasekit_next_action` tool for the current workspace root.",
      "Return the tool result directly and do not advance state or guess the next stage in this command markdown.",
    ],
  },
  {
    name: "pk-config",
    description: "Show Phasekit configuration-relevant project state.",
    body: [
      "Call the `phasekit_get_status` tool for the current workspace root, then call `phasekit_next_action` only if more guidance is needed.",
      "Report the tool results without reading, merging, or rewriting configuration in this command markdown.",
    ],
  },
];

function renderCommand(template: CommandTemplate): string {
  return [
    managedMarker,
    "---",
    `description: ${template.description}`,
    "---",
    "",
    `# /${template.name}`,
    "",
    ...template.body,
    "",
  ].join("\n");
}

async function assertManagedOrMissing(path: string): Promise<void> {
  let existing: string;

  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }

    throw error;
  }

  if (!existing.startsWith(managedMarker)) {
    throw new Error(`Refusing to overwrite unmanaged OpenCode command artifact: ${path}`);
  }
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
