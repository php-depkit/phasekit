import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const installPackageName = "@phasekit/install" as const;

const commandManagedMarker = "<!-- phasekit:managed opencode-command v1 -->";
const agentManagedMarker = "<!-- phasekit:managed opencode-agent v1 -->";

export type OpenCodeCommandName = "pk-init" | "pk-status" | "pk-next" | "pk-config" | "pk-ingest" | "pk-add-phase" | "pk-run-phase" | "pk-verify";
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

export type InstallOpenCodeCommandArtifactsOptions = {
  homeDir?: string;
  configRoot?: string;
};

export type InstallOpenCodeAgentArtifactsOptions = InstallOpenCodeCommandArtifactsOptions;

export type InstallOpenCodeBootstrapArtifactsOptions = InstallOpenCodeCommandArtifactsOptions;

export type InstallOpenCodeCommandArtifactsResult = {
  commandsDir: string;
  artifacts: OpenCodeCommandArtifact[];
};

export type InstallOpenCodeAgentArtifactsResult = {
  agentsDir: string;
  artifacts: OpenCodeAgentArtifact[];
};

export type InstallOpenCodeBootstrapArtifactsResult = {
  commands: InstallOpenCodeCommandArtifactsResult;
  agents: InstallOpenCodeAgentArtifactsResult;
};

export function describeInstallPackage(): { name: typeof installPackageName } {
  return { name: installPackageName };
}

export function getOpenCodeCommandsDir(options: InstallOpenCodeCommandArtifactsOptions = {}): string {
  return join(options.configRoot ?? join(options.homeDir ?? homedir(), ".config"), "opencode", "commands");
}

export function getOpenCodeAgentsDir(options: InstallOpenCodeAgentArtifactsOptions = {}): string {
  return join(options.configRoot ?? join(options.homeDir ?? homedir(), ".config"), "opencode", "agents");
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
    await assertManagedOrMissing(artifact.path, commandManagedMarker, "command");
    await writeFile(artifact.path, artifact.content, "utf8");
  }

  return { commandsDir, artifacts };
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

  for (const artifact of artifacts) {
    await assertManagedOrMissing(artifact.path, agentManagedMarker, "agent");
    await writeFile(artifact.path, artifact.content, "utf8");
  }

  return { agentsDir, artifacts };
}

export async function installOpenCodeBootstrapArtifacts(
  options: InstallOpenCodeBootstrapArtifactsOptions = {},
): Promise<InstallOpenCodeBootstrapArtifactsResult> {
  const commands = await installOpenCodeCommandArtifacts(options);
  const agents = await installOpenCodeAgentArtifacts(options);

  return {
    commands,
    agents,
  };
}

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

async function assertManagedOrMissing(path: string, marker: string, artifactKind: "command" | "agent"): Promise<void> {
  let existing: string;

  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }

    throw error;
  }

  if (!existing.startsWith(marker)) {
    throw new Error(`Refusing to overwrite unmanaged OpenCode ${artifactKind} artifact: ${path}`);
  }
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
