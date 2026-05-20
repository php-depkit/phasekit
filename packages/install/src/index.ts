import { mkdir, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";

export const installPackageName = "@depkit/phasekit-install" as const;
export const defaultPhasekitPluginSpec = "@depkit/phasekit-opencode" as const;

const opencodeConfigSchemaUrl = "https://opencode.ai/config.json" as const;
const legacyPhasekitPluginSpec = "@depkit/phasekit-opencode/plugin" as const;
const managedPhasekitPluginSpecs = [defaultPhasekitPluginSpec, legacyPhasekitPluginSpec] as const;
const commandManagedMarkerPrefix = "<!-- phasekit:managed opencode-command ";
const agentManagedMarkerPrefix = "<!-- phasekit:managed opencode-agent ";
const commandManagedMarker = "<!-- phasekit:managed opencode-command v1 -->";
const agentManagedMarker = "<!-- phasekit:managed opencode-agent v1 -->";
const formattingOptions = { insertSpaces: true, tabSize: 2, eol: "\n" } as const;

export type OpenCodeCommandName =
  | "pk-init"
  | "pk-status"
  | "pk-next"
  | "pk-config"
  | "pk-ingest"
  | "pk-add-phase"
  | "pk-run-phase"
  | "pk-verify";

export type OpenCodeAgentName =
  | "orchestrator"
  | "context-scout"
  | "prd-ingestor"
  | "grill-me"
  | "slice-planner"
  | "task-planner"
  | "executor"
  | "reviewer"
  | "verifier"
  | "repairer"
  | "docs-writer";

export type OpenCodeCommandArtifact = {
  name: OpenCodeCommandName;
  path: string;
  content: string;
};

export type OpenCodeAgentArtifact = {
  name: OpenCodeAgentName;
  path: string;
  content: string;
};

export type OpenCodeInstallScopeOptions = {
  homeDir?: string;
  configRoot?: string;
  projectDir?: string;
  overwriteUnmanaged?: boolean;
};

export type InstallOpenCodeCommandArtifactsOptions = OpenCodeInstallScopeOptions;
export type InstallOpenCodeAgentArtifactsOptions = OpenCodeInstallScopeOptions;
export type InstallOpenCodeBootstrapArtifactsOptions = OpenCodeInstallScopeOptions;

export type InstallOpenCodeCommandArtifactsResult = {
  commandsDir: string;
  artifacts: OpenCodeCommandArtifact[];
  removedPaths: string[];
};

export type InstallOpenCodeAgentArtifactsResult = {
  agentsDir: string;
  artifacts: OpenCodeAgentArtifact[];
  removedPaths: string[];
};

export type InstallOpenCodeBootstrapArtifactsResult = {
  commands: InstallOpenCodeCommandArtifactsResult;
  agents: InstallOpenCodeAgentArtifactsResult;
};

export type InstallPhasekitOpenCodeOptions = OpenCodeInstallScopeOptions & {
  pluginSpec?: string;
};

export type UninstallPhasekitOpenCodeOptions = OpenCodeInstallScopeOptions;

export type InstallPhasekitOpenCodeResult = {
  scope: "global" | "project";
  baseDir: string;
  pluginSpec: string;
  config: UpdateOpenCodeConfigResult;
  commands: InstallOpenCodeCommandArtifactsResult;
  agents: InstallOpenCodeAgentArtifactsResult;
};

export type UninstallPhasekitOpenCodeResult = {
  scope: "global" | "project";
  baseDir: string;
  config: UpdateOpenCodeConfigResult;
  commandsDir: string;
  agentsDir: string;
  removedPaths: string[];
};

export type UpdateOpenCodeConfigResult = {
  configPath: string;
  created: boolean;
  updated: boolean;
  removedManagedPluginSpecs: string[];
};

type OpenCodeLayout = {
  scope: "global" | "project";
  baseDir: string;
  configPath: string;
  commandsDir: string;
  agentsDir: string;
};

type CommandTemplate = {
  name: OpenCodeCommandName;
  description: string;
  body: string[];
};

type AgentTemplate = {
  name: OpenCodeAgentName;
  description: string;
  responsibility: string;
  rules?: string[];
};

type OpenCodePluginEntry = string | [string, ...unknown[]] | unknown;

const commandTemplates: CommandTemplate[] = [
  {
    name: "pk-init",
    description: "Initialize Phasekit state for this workspace.",
    body: [
      "This command is a native Phasekit tool wrapper, not a project exploration task.",
      "Your next action must be to call `phasekit_init_project` for the current workspace root.",
      "Do not call `glob`, `read`, `grep`, `bash`, or any other exploratory tool before `phasekit_init_project`.",
      "Do not inspect files, infer stack, infer verification commands, or manually read PRD/implementation documents; the init tool owns discovery.",
      "If the user provides explicit product or implementation document paths as command arguments, pass those exact paths as `contextPaths`. Otherwise omit `contextPaths` and rely on the tool's default discovery for `PRD.md` and `IMPLEMENTATION-GUIDE.md` in the workspace root and `.planning/`.",
      "After the tool returns, return its result directly and stop. Do not create or edit `.planning` files from this command markdown.",
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
  {
    name: "pk-ingest",
    description: "Ingest one or more product input paths through Phasekit.",
    body: [
      "Call the `phasekit_ingest_paths` tool for the current workspace root with the user-provided paths as `inputPaths`.",
      "Return the tool result directly and do not expand paths, extract requirements, or write `.planning` state from this command markdown.",
    ],
  },
  {
    name: "pk-add-phase",
    description: "Add one Phasekit phase from a short goal.",
    body: [
      "Call the `phasekit_add_phase` tool for the current workspace root with the user-provided goal as `goal`.",
      "Return the tool result directly and do not create requirements, plan slices, or write `.planning` state from this command markdown.",
    ],
  },
  {
    name: "pk-run-phase",
    description: "Run or resume one Phasekit phase through native tools.",
    body: [
      "If the user provides a phase id, pass that id to the native `phasekit_run_phase` tool for the current workspace root.",
      "If the user does not provide a phase id, call `phasekit_next_action` and follow the returned native Phasekit tool direction instead of guessing from files or chat history.",
      "Use `phasekit_get_status` to report current run state after tool calls and do not implement planning, task execution, review, verification, commit-gating, or `.planning` mutations in this command markdown.",
    ],
  },
  {
    name: "pk-verify",
    description: "Execute scoped Phasekit verification through native tools.",
    body: [
      "Call the `phasekit_verify_scope` tool for the current workspace root with the user-provided verification scope as `scope`.",
      "Return the tool result directly; native tools execute approved checks and persist `.planning/verifications/<scope-id>.json`. Focused repair follow-up is created on failure only when a matching phase run context is available to update.",
      "If the tool reports a missing or invalid scope, ask for a task, phase, group, or all scope instead of inventing one.",
    ],
  },
];

const agentTemplates: AgentTemplate[] = [
  {
    name: "orchestrator",
    description: "Coordinate approved Phasekit stages through native tools.",
    responsibility: "Use approved Phasekit plans and native Phasekit tools to report status, next actions, and blockers without inventing state transitions.",
  },
  {
    name: "context-scout",
    description: "Find relevant project context for Phasekit planning.",
    responsibility: "Inspect project code, tests, routes, schemas, and conventions requested by an approved plan, then report concrete findings only.",
  },
  {
    name: "prd-ingestor",
    description: "Extract requirements from approved product inputs.",
    responsibility: "Extract requirements, acceptance criteria, non-goals, and ambiguity from provided source material for native Phasekit ingestion tools to validate.",
  },
  {
    name: "grill-me",
    description: "Ask focused questions for ambiguous Phasekit requirements.",
    responsibility: "Surface blocking ambiguities as high-signal questions when implementation would otherwise require assumptions.",
  },
  {
    name: "slice-planner",
    description: "Propose small Phasekit implementation slices.",
    responsibility: "Turn validated requirements and context into small vertical phase proposals for native Phasekit validators to accept or reject.",
  },
  {
    name: "task-planner",
    description: "Propose scoped tasks for one approved phase.",
    responsibility: "Break one approved phase into small tasks with source coverage and checks, leaving validation to native Phasekit tools.",
  },
  {
    name: "executor",
    description: "Implement one scoped Phasekit task.",
    responsibility: "Make only the changes requested by one approved task and stop with a blocker when scope is unclear or drifting.",
    rules: [
      "Work on exactly one claimed task for the active run; do not claim, start, or execute a second task in the same assignment.",
      "Use `phasekit_claim_task` before editing when that native tool exists; stop if the tool cannot claim exactly the assigned task.",
      "Use `phasekit_complete_task` only after required checks and changed-file evidence are available when that native tool exists.",
      "Use `phasekit_record_blocker` when that native tool exists for scope drift, ambiguity, missing evidence, failed required checks, unplanned changed files, or missing required tool support.",
    ],
  },
  {
    name: "reviewer",
    description: "Review scoped Phasekit changes for correctness.",
    responsibility: "Review changed code against the approved plan, requirements, project conventions, and regression risks without marking work complete.",
    rules: [
      "Review only the assigned scope and call out any scope expansion as a blocker.",
      "Do not approve completion when required scoped checks are missing, skipped without approval, or only described in markdown.",
    ],
  },
  {
    name: "verifier",
    description: "Verify Phasekit requirements and project fit.",
    responsibility: "Run or inspect only approved checks and report verification evidence for native Phasekit tools to record.",
    rules: [
      "Use `phasekit_verify_scope` to validate the requested task, phase, group, or all scope before verification work.",
      "Run or inspect only checks already approved for the validated scope; do not silently add, broaden, or substitute checks.",
      "When a missing check is needed, propose it for user approval and stop instead of executing it unapproved.",
      "Verify linked requirements and whole-project integration risks, not only changed files or isolated task output.",
    ],
  },
  {
    name: "repairer",
    description: "Repair focused Phasekit verification failures.",
    responsibility: "Fix only the specific verified failure or blocker assigned by an approved plan, then return for review and verification.",
    rules: [
      "Repair exactly one focused verifier or reviewer failure at a time and stop if the requested fix requires broader product decisions.",
      "Do not create or persist repair-loop state from this artifact; native Phasekit tools own persistence when that behavior exists.",
      "After a repair, report changed files and the scoped checks that need review or verification rather than marking the run complete.",
    ],
  },
  {
    name: "docs-writer",
    description: "Draft factual Phasekit project documentation.",
    responsibility: "Create user-facing documentation from actual project files, commands, and approved requirements without inventing behavior.",
  },
];

export function describeInstallPackage(): { name: typeof installPackageName } {
  return { name: installPackageName };
}

export function getOpenCodeBaseDir(options: OpenCodeInstallScopeOptions = {}): string {
  if (options.projectDir !== undefined) {
    return join(options.projectDir, ".opencode");
  }

  return join(options.configRoot ?? join(options.homeDir ?? homedir(), ".config"), "opencode");
}

export function getOpenCodeCommandsDir(options: InstallOpenCodeCommandArtifactsOptions = {}): string {
  return join(getOpenCodeBaseDir(options), "commands");
}

export function getOpenCodeAgentsDir(options: InstallOpenCodeAgentArtifactsOptions = {}): string {
  return join(getOpenCodeBaseDir(options), "agents");
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
  if (!options.overwriteUnmanaged) {
    await assertManagedOrMissingArtifacts(artifacts, commandManagedMarkerPrefix, "command");
  }

  for (const artifact of artifacts) {
    await writeFile(artifact.path, artifact.content, "utf8");
  }

  const removedPaths = await removeSupersededManagedArtifacts(
    commandsDir,
    new Set(artifacts.map((artifact) => artifact.path)),
    commandManagedMarkerPrefix,
  );

  return { commandsDir, artifacts, removedPaths };
}

export function generateOpenCodeAgentArtifacts(
  options: InstallOpenCodeAgentArtifactsOptions = {},
): OpenCodeAgentArtifact[] {
  const agentsDir = getOpenCodeAgentsDir(options);

  return agentTemplates.map((template) => ({
    name: template.name,
    path: join(agentsDir, `${template.name}.md`),
    content: renderAgent(template),
  }));
}

export async function installOpenCodeAgentArtifacts(
  options: InstallOpenCodeAgentArtifactsOptions = {},
): Promise<InstallOpenCodeAgentArtifactsResult> {
  const agentsDir = getOpenCodeAgentsDir(options);
  const artifacts = generateOpenCodeAgentArtifacts(options);

  await mkdir(agentsDir, { recursive: true });
  if (!options.overwriteUnmanaged) {
    await assertManagedOrMissingArtifacts(artifacts, agentManagedMarkerPrefix, "agent");
  }

  for (const artifact of artifacts) {
    await writeFile(artifact.path, artifact.content, "utf8");
  }

  const removedPaths = await removeSupersededManagedArtifacts(
    agentsDir,
    new Set(artifacts.map((artifact) => artifact.path)),
    agentManagedMarkerPrefix,
  );

  return { agentsDir, artifacts, removedPaths };
}

export async function installOpenCodeBootstrapArtifacts(
  options: InstallOpenCodeBootstrapArtifactsOptions = {},
): Promise<InstallOpenCodeBootstrapArtifactsResult> {
  if (!options.overwriteUnmanaged) {
    await assertInstallArtifactsWritable(options);
  }
  const commands = await installOpenCodeCommandArtifacts(options);
  const agents = await installOpenCodeAgentArtifacts(options);

  return {
    commands,
    agents,
  };
}

export async function installPhasekitOpenCode(
  options: InstallPhasekitOpenCodeOptions = {},
): Promise<InstallPhasekitOpenCodeResult> {
  const layout = await resolveOpenCodeLayout(options);
  const pluginSpec = options.pluginSpec ?? defaultPhasekitPluginSpec;
  if (!options.overwriteUnmanaged) {
    await assertInstallArtifactsWritable(options);
  }
  const config = await installPhasekitPluginConfig(layout.configPath, pluginSpec);
  const commands = await installOpenCodeCommandArtifacts(options);
  const agents = await installOpenCodeAgentArtifacts(options);

  return {
    scope: layout.scope,
    baseDir: layout.baseDir,
    pluginSpec,
    config,
    commands,
    agents,
  };
}

export async function uninstallPhasekitOpenCode(
  options: UninstallPhasekitOpenCodeOptions = {},
): Promise<UninstallPhasekitOpenCodeResult> {
  const layout = await resolveOpenCodeLayout(options);
  const config = await uninstallPhasekitPluginConfig(layout.configPath);
  const removedCommandPaths = await removeManagedArtifacts(layout.commandsDir, commandManagedMarkerPrefix);
  const removedAgentPaths = await removeManagedArtifacts(layout.agentsDir, agentManagedMarkerPrefix);

  await removeDirectoryIfEmpty(layout.commandsDir);
  await removeDirectoryIfEmpty(layout.agentsDir);

  return {
    scope: layout.scope,
    baseDir: layout.baseDir,
    config,
    commandsDir: layout.commandsDir,
    agentsDir: layout.agentsDir,
    removedPaths: [...removedCommandPaths, ...removedAgentPaths],
  };
}

async function resolveOpenCodeLayout(options: OpenCodeInstallScopeOptions): Promise<OpenCodeLayout> {
  const baseDir = getOpenCodeBaseDir(options);

  return {
    scope: options.projectDir !== undefined ? "project" : "global",
    baseDir,
    configPath: await resolveOpenCodeConfigPath(baseDir),
    commandsDir: join(baseDir, "commands"),
    agentsDir: join(baseDir, "agents"),
  };
}

async function resolveOpenCodeConfigPath(baseDir: string): Promise<string> {
  for (const candidate of [join(baseDir, "opencode.jsonc"), join(baseDir, "opencode.json")]) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return join(baseDir, "opencode.jsonc");
}

async function installPhasekitPluginConfig(configPath: string, pluginSpec: string): Promise<UpdateOpenCodeConfigResult> {
  const existing = await readTextFileIfExists(configPath);
  const created = existing === undefined;
  let text = existing ?? "{}\n";
  const config = parseOpenCodeConfig(text, configPath);
  const currentPluginEntries = Array.isArray(config.plugin) ? config.plugin : [];
  const { remainingEntries, removedManagedPluginSpecs } = splitManagedPluginEntries(currentPluginEntries);
  const nextPluginEntries = [...remainingEntries, pluginSpec];

  if (config.$schema === undefined) {
    text = applyJsoncValue(text, ["$schema"], opencodeConfigSchemaUrl);
  }

  text = applyJsoncValue(text, ["plugin"], nextPluginEntries);
  text = ensureTrailingNewline(text);

  if (created || existing !== text) {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, text, "utf8");
  }

  return {
    configPath,
    created,
    updated: created || existing !== text,
    removedManagedPluginSpecs,
  };
}

async function uninstallPhasekitPluginConfig(configPath: string): Promise<UpdateOpenCodeConfigResult> {
  const existing = await readTextFileIfExists(configPath);

  if (existing === undefined) {
    return {
      configPath,
      created: false,
      updated: false,
      removedManagedPluginSpecs: [],
    };
  }

  const config = parseOpenCodeConfig(existing, configPath);
  const currentPluginEntries = Array.isArray(config.plugin) ? config.plugin : [];
  const { remainingEntries, removedManagedPluginSpecs } = splitManagedPluginEntries(currentPluginEntries);
  let text = existing;

  if (removedManagedPluginSpecs.length === 0) {
    return {
      configPath,
      created: false,
      updated: false,
      removedManagedPluginSpecs,
    };
  }

  text = applyJsoncValue(text, ["plugin"], remainingEntries.length === 0 ? undefined : remainingEntries);
  text = ensureTrailingNewline(text);

  if (existing !== text) {
    await writeFile(configPath, text, "utf8");
  }

  return {
    configPath,
    created: false,
    updated: existing !== text,
    removedManagedPluginSpecs,
  };
}

function splitManagedPluginEntries(entries: OpenCodePluginEntry[]): {
  remainingEntries: OpenCodePluginEntry[];
  removedManagedPluginSpecs: string[];
} {
  const managedSpecs = new Set<string>();
  const remainingEntries: OpenCodePluginEntry[] = [];

  for (const entry of entries) {
    const spec = getPluginEntrySpecifier(entry);

    if (spec !== undefined && managedPhasekitPluginSpecs.includes(spec as typeof managedPhasekitPluginSpecs[number])) {
      managedSpecs.add(spec);
      continue;
    }

    remainingEntries.push(entry);
  }

  return {
    remainingEntries,
    removedManagedPluginSpecs: [...managedSpecs],
  };
}

function getPluginEntrySpecifier(entry: OpenCodePluginEntry): string | undefined {
  if (typeof entry === "string") {
    return entry;
  }

  if (Array.isArray(entry) && typeof entry[0] === "string") {
    return entry[0];
  }

  return undefined;
}

function parseOpenCodeConfig(text: string, configPath: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const parsed = parse(text, errors, { allowTrailingComma: true, disallowComments: false });

  if (errors.length > 0) {
    throw new Error(`Failed to parse OpenCode config ${configPath}.`);
  }

  if (parsed === undefined) {
    return {};
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Expected OpenCode config ${configPath} to contain a JSON object.`);
  }

  return parsed;
}

function applyJsoncValue(text: string, path: (string | number)[], value: unknown): string {
  return applyEdits(
    text,
    modify(text, path, value, {
      formattingOptions,
    }),
  );
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function renderCommand(template: CommandTemplate): string {
  return [
    commandManagedMarker,
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

function renderAgent(template: AgentTemplate): string {
  return [
    agentManagedMarker,
    "---",
    `description: ${template.description}`,
    "---",
    "",
    `# ${template.name}`,
    "",
    "You are a Phasekit sub-agent stub. Stay within the active approved plan and use Phasekit plugin tools as the executable surface.",
    "",
    "## Responsibility",
    "",
    template.responsibility,
    "",
    "## Hard Rules",
    "",
    "- Do not make assumptions when an answer affects architecture, public behavior, state schema, plugin behavior, command names, persistence, or implementation scope.",
    "- Do not perform broad rewrites, unrelated refactors, or scope expansion beyond the assigned approved plan.",
    "- Do not continue through scope drift; stop and report a blocker with the specific missing decision or validation.",
    ...(template.rules?.map((rule) => `- ${rule}`) ?? []),
    "- Do not add compatibility with old GSD commands, workflows, naming, or behavior.",
    "- Do not treat markdown artifacts, chat history, summaries, or generated files as runtime state or proof of completion.",
    "- Do not bypass native Phasekit tool validation; tools own state transitions, completion, artifact writes, and verification records.",
    "- Do not register OpenCode commands or agents at runtime from plugin code; visibility comes from generated artifacts.",
    "",
    "## Tool-Focused Workflow",
    "",
    "1. Read the approved plan and relevant Phasekit state before acting.",
    "2. Use available Phasekit plugin tools for status, next action, validation, artifact writing, and state changes when those tools exist.",
    "3. Report concrete findings, changes, checks, blockers, and tool results without inventing missing Phasekit behavior.",
    "",
  ].join("\n");
}

async function removeSupersededManagedArtifacts(
  dir: string,
  expectedPaths: Set<string>,
  markerPrefix: string,
): Promise<string[]> {
  const entries = await readDirectoryEntries(dir);
  const removedPaths: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const path = join(dir, entry.name);

    if (expectedPaths.has(path) || !(await isManagedArtifact(path, markerPrefix))) {
      continue;
    }

    await rm(path, { force: true });
    removedPaths.push(path);
  }

  return removedPaths.sort();
}

async function assertInstallArtifactsWritable(options: OpenCodeInstallScopeOptions): Promise<void> {
  await assertManagedOrMissingArtifacts(generateOpenCodeCommandArtifacts(options), commandManagedMarkerPrefix, "command");
  await assertManagedOrMissingArtifacts(generateOpenCodeAgentArtifacts(options), agentManagedMarkerPrefix, "agent");
}

async function removeManagedArtifacts(dir: string, markerPrefix: string): Promise<string[]> {
  const entries = await readDirectoryEntries(dir);
  const removedPaths: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const path = join(dir, entry.name);

    if (!(await isManagedArtifact(path, markerPrefix))) {
      continue;
    }

    await rm(path, { force: true });
    removedPaths.push(path);
  }

  return removedPaths.sort();
}

async function isManagedArtifact(path: string, markerPrefix: string): Promise<boolean> {
  const content = await readTextFileIfExists(path);
  return content !== undefined && content.startsWith(markerPrefix);
}

async function assertManagedOrMissingArtifacts(
  artifacts: Array<{ path: string }>,
  markerPrefix: string,
  artifactKind: "command" | "agent",
): Promise<void> {
  const conflicts: string[] = [];

  for (const artifact of artifacts) {
    const existing = await readTextFileIfExists(artifact.path);

    if (existing !== undefined && !existing.startsWith(markerPrefix)) {
      conflicts.push(artifact.path);
    }
  }

  if (conflicts.length === 0) {
    return;
  }

  if (conflicts.length === 1) {
    throw new Error(`Refusing to overwrite unmanaged OpenCode ${artifactKind} artifact: ${conflicts[0]}`);
  }

  throw new Error(
    `Refusing to overwrite unmanaged OpenCode ${artifactKind} artifacts:\n${conflicts.map((path) => `- ${path}`).join("\n")}`,
  );
}

async function readTextFileIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readDirectoryEntries(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }

    throw error;
  }
}

async function removeDirectoryIfEmpty(path: string): Promise<void> {
  try {
    const entries = await readdir(path);

    if (entries.length === 0) {
      await rmdir(path);
    }
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }

    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  return (await readTextFileIfExists(path)) !== undefined;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function formatInstallSummary(result: InstallPhasekitOpenCodeResult): string {
  return [
    `Installed Phasekit OpenCode artifacts (${result.scope}).`,
    `Config: ${result.config.configPath}`,
    `Plugin: ${result.pluginSpec}`,
    `Commands: ${result.commands.artifacts.length} written, ${result.commands.removedPaths.length} removed`,
    `Agents: ${result.agents.artifacts.length} written, ${result.agents.removedPaths.length} removed`,
  ].join("\n");
}

export function formatUninstallSummary(result: UninstallPhasekitOpenCodeResult): string {
  return [
    `Uninstalled Phasekit OpenCode artifacts (${result.scope}).`,
    `Config: ${result.config.configPath}`,
    `Plugin entries removed: ${result.config.removedManagedPluginSpecs.length}`,
    `Managed artifacts removed: ${result.removedPaths.length}`,
  ].join("\n");
}
