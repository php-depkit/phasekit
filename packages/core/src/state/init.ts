import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { loadPhasekitConfig } from "../config/loader";
import {
  confirmStackQuestionAnswer,
  decideStack,
  writeConfirmedProjectStack,
  type StackDecision,
  type StackQuestionAnswer,
} from "../greenfield/index";
import { validateGrillMeQuestionAnswer, type GrillMeQuestion, type GrillMeQuestionAnswer } from "../planning/slices";
import type { PhasekitConfigOverride } from "../config/schema";
import { discoverVerificationCommands, type PackageManager, type VerificationCommand } from "../verify/commands";
import {
  defaultPhasesState,
  defaultProjectState,
  defaultRequirementsState,
  defaultRulesState,
} from "./defaults";
import { readJsonFile, writeJsonFile } from "./json";
import { phasekitConfigOverrideSchema } from "../config/schema";
import { projectStateSchema } from "./schema";

type PlanningEntry = {
  path: string;
  kind: "directory" | "file";
  value?: unknown;
};

export type InitializePlanningStateOptions = {
  config?: PhasekitConfigOverride;
  configRoot?: string;
  contextPaths?: string[];
  verificationCommandAnswer?: GrillMeQuestionAnswer;
  stackAnswer?: StackQuestionAnswer;
  confirmationAnswer?: GrillMeQuestionAnswer;
};

export type InitContextDocument = {
  path: string;
  text: string;
  source: "discovered" | "explicit";
};

export type InitProjectDiscovery = {
  package_manager: PackageManager | "unknown";
  test_commands: string[];
  build_commands: string[];
  project_structure_signals: string[];
};

export type InitVerificationCommandDiscovery = {
  commands: VerificationCommand[];
  requires_confirmation: boolean;
  question?: GrillMeQuestion;
  stored_in_project_config: boolean;
};

export type InitializePlanningStateResult = {
  createdPaths: string[];
  existingPaths: string[];
  context_documents: InitContextDocument[];
  discovery: InitProjectDiscovery;
  verification_commands: InitVerificationCommandDiscovery;
  stack_decision: StackDecision;
};

const verifyCommandQuestionId = "init-verify-commands";

function toRelativePath(rootDir: string, targetPath: string): string {
  return relative(rootDir, targetPath).replaceAll("\\", "/");
}

async function getExistingKind(targetPath: string): Promise<"directory" | "file" | null> {
  try {
    const stats = await stat(targetPath);

    if (stats.isDirectory()) {
      return "directory";
    }

    if (stats.isFile()) {
      return "file";
    }

    return null;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function ensurePlanningEntry(
  rootDir: string,
  entry: PlanningEntry,
  result: InitializePlanningStateResult,
): Promise<void> {
  const existingKind = await getExistingKind(entry.path);
  const relativePath = toRelativePath(rootDir, entry.path);

  if (existingKind === entry.kind) {
    result.existingPaths.push(relativePath);
    return;
  }

  if (existingKind !== null) {
    throw new Error(
      `Cannot initialize ${relativePath}: expected a ${entry.kind}, found a ${existingKind}`,
    );
  }

  if (entry.kind === "directory") {
    await mkdir(entry.path, { recursive: true });
  } else {
    await writeJsonFile(entry.path, entry.value);
  }

  result.createdPaths.push(relativePath);
}

export async function initializePlanningState(
  rootDir: string,
  options: InitializePlanningStateOptions = {},
): Promise<InitializePlanningStateResult> {
  const planningDir = join(rootDir, ".planning");
  const result: InitializePlanningStateResult = {
    createdPaths: [],
    existingPaths: [],
    context_documents: [],
    discovery: {
      package_manager: "unknown",
      test_commands: [],
      build_commands: [],
      project_structure_signals: [],
    },
    verification_commands: {
      commands: [],
      requires_confirmation: false,
      stored_in_project_config: false,
    },
    stack_decision: { kind: "none", reason: "existing-implementation" },
  };
  const entries: PlanningEntry[] = [
    { path: planningDir, kind: "directory" },
    { path: join(planningDir, "project.json"), kind: "file", value: defaultProjectState },
    { path: join(planningDir, "config.json"), kind: "file", value: options.config ?? {} },
    {
      path: join(planningDir, "requirements.json"),
      kind: "file",
      value: defaultRequirementsState,
    },
    { path: join(planningDir, "phases.json"), kind: "file", value: defaultPhasesState },
    { path: join(planningDir, "rules.json"), kind: "file", value: defaultRulesState },
    { path: join(planningDir, "runs"), kind: "directory" },
    { path: join(planningDir, "verifications"), kind: "directory" },
  ];

  for (const entry of entries) {
    await ensurePlanningEntry(rootDir, entry, result);
  }

  result.context_documents = await discoverInitContextDocuments(rootDir, options.contextPaths);

  const resolvedConfig = await loadPhasekitConfig({
    projectRoot: rootDir,
    globalConfigPath: options.configRoot ? join(options.configRoot, "phasekit", "config.json") : undefined,
  });
  const packageMetadata = await readPackageMetadata(rootDir);
  const discoveredCommands = discoverVerificationCommands({
    config: resolvedConfig.verification,
    packageMetadata: packageMetadata ? [packageMetadata] : [],
  });
  const projectSignals = await discoverProjectStructureSignals(rootDir);
  const testCommands = discoveredCommands.filter((command) => command.kind === "test").map((command) => command.command);
  const buildCommands = discoveredCommands.filter((command) => command.kind === "build").map((command) => command.command);
  const stackDecision = decideStack({
    project: await readJsonFile(join(planningDir, "project.json"), projectStateSchema),
    repository: {
      implementationFiles: projectSignals.filter((signal) => signal.startsWith("file:"))
        .map((signal) => signal.replace("file:", "")),
      stackDeclarations: [],
    },
    greenfield: { recommend_stack: resolvedConfig.greenfield.recommend_stack },
    recommendedStack: inferRecommendedStack(packageMetadata, projectSignals),
  });

  const discoveredOnlyCommands = discoveredCommands.filter((command) => command.source === "discovered");
  const verifyQuestion = discoveredOnlyCommands.length > 0
    ? createVerificationCommandQuestion(discoveredOnlyCommands)
    : undefined;
  const verificationCommandAnswer = options.verificationCommandAnswer ?? options.confirmationAnswer;
  const explicitApproval = verifyQuestion && verificationCommandAnswer
    ? resolveVerificationCommandApproval(verifyQuestion, verificationCommandAnswer)
    : false;

  let storedInProjectConfig = false;

  if (explicitApproval) {
    const configPath = join(planningDir, "config.json");
    const existingConfig = await readJsonFile(configPath, phasekitConfigOverrideSchema);
    const nextCommands = {
      ...existingConfig.verification?.commands,
      ...Object.fromEntries(discoveredOnlyCommands.map((command) => [command.kind, { command: command.command }])),
    };
    const nextConfig = {
      ...existingConfig,
      verification: {
        ...(existingConfig.verification ?? {}),
        commands: nextCommands,
      },
    };

    if (!isDeepStrictEqual(existingConfig, nextConfig)) {
      await writeJsonFile(configPath, nextConfig);
      storedInProjectConfig = true;
    }
  }

  result.discovery = {
    package_manager: packageMetadata?.packageManager ?? "unknown",
    test_commands: testCommands,
    build_commands: buildCommands,
    project_structure_signals: projectSignals.filter((signal) => !signal.startsWith("file:")),
  };
  result.verification_commands = {
    commands: discoveredOnlyCommands,
    requires_confirmation: discoveredOnlyCommands.length > 0,
    question: verifyQuestion,
    stored_in_project_config: storedInProjectConfig,
  };
  result.stack_decision = await resolveInitStackDecision(rootDir, stackDecision, options.stackAnswer);

  return result;
}

const defaultInitContextDocumentPaths = [
  "PRD.md",
  ".planning/PRD.md",
  "IMPLEMENTATION-GUIDE.md",
  ".planning/IMPLEMENTATION-GUIDE.md",
] as const;

async function discoverInitContextDocuments(rootDir: string, explicitPaths: readonly string[] | undefined): Promise<InitContextDocument[]> {
  const documents = new Map<string, InitContextDocument>();

  for (const relativePath of defaultInitContextDocumentPaths) {
    const absolutePath = join(rootDir, relativePath);
    if (await getExistingKind(absolutePath) !== "file") {
      continue;
    }

    documents.set(relativePath, {
      path: relativePath,
      text: await readFile(absolutePath, "utf8"),
      source: "discovered",
    });
  }

  for (const inputPath of explicitPaths ?? []) {
    const absolutePath = resolve(rootDir, inputPath);
    const relativePath = toRelativePath(rootDir, absolutePath);
    const kind = await getExistingKind(absolutePath);

    if (kind !== "file") {
      throw new Error(`Cannot load init context document ${relativePath}: expected a file.`);
    }

    documents.set(relativePath, {
      path: relativePath,
      text: await readFile(absolutePath, "utf8"),
      source: "explicit",
    });
  }

  return [...documents.values()].sort((left, right) => left.path.localeCompare(right.path));
}

async function resolveInitStackDecision(
  rootDir: string,
  stackDecision: StackDecision,
  stackAnswer?: StackQuestionAnswer,
): Promise<StackDecision> {
  if (stackDecision.kind === "confirmed") {
    if (stackDecision.source === "project") {
      return stackDecision;
    }

    const project = await writeConfirmedProjectStack(rootDir, stackDecision.stack);
    return {
      ...stackDecision,
      project,
    };
  }

  if (stackDecision.kind !== "question" || stackAnswer === undefined) {
    return stackDecision;
  }

  if (stackAnswer.question.id !== stackDecision.question.id) {
    return {
      kind: "blocker",
      reason: `Stack answer question id ${stackAnswer.question.id} does not match expected ${stackDecision.question.id}.`,
      next_step: "Answer the active greenfield stack question before planning implementation.",
    };
  }

  const confirmed = confirmStackQuestionAnswer(stackAnswer);
  if (confirmed.kind !== "confirmed") {
    return confirmed;
  }

  const project = await writeConfirmedProjectStack(rootDir, confirmed.stack);
  return {
    ...confirmed,
    project,
  };
}

async function readPackageMetadata(rootDir: string): Promise<{ packageManager: PackageManager; scripts: Record<string, string> } | undefined> {
  const packagePath = join(rootDir, "package.json");

  try {
    const pkg = JSON.parse(await readFile(packagePath, "utf8")) as { packageManager?: string; scripts?: Record<string, string> };
    const packageManager = pkg.packageManager?.startsWith("npm")
      ? "npm"
      : pkg.packageManager?.startsWith("pnpm")
        ? "pnpm"
        : pkg.packageManager?.startsWith("yarn")
          ? "yarn"
          : pkg.packageManager?.startsWith("bun")
            ? "bun"
            : await inferLikelyPackageManager(rootDir);
    return { packageManager, scripts: pkg.scripts ?? {} };
  } catch {
    return undefined;
  }
}

async function inferLikelyPackageManager(rootDir: string): Promise<PackageManager> {
  const lockfileToManager: ReadonlyArray<{ fileName: string; packageManager: PackageManager }> = [
    { fileName: "pnpm-lock.yaml", packageManager: "pnpm" },
    { fileName: "yarn.lock", packageManager: "yarn" },
    { fileName: "package-lock.json", packageManager: "npm" },
    { fileName: "npm-shrinkwrap.json", packageManager: "npm" },
    { fileName: "bun.lock", packageManager: "bun" },
    { fileName: "bun.lockb", packageManager: "bun" },
  ];

  for (const lockfile of lockfileToManager) {
    if (await getExistingKind(join(rootDir, lockfile.fileName)) === "file") {
      return lockfile.packageManager;
    }
  }

  return "npm";
}

async function discoverProjectStructureSignals(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const signals = new Set<string>();

  for (const entry of entries) {
    if (entry.name === ".planning" || entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }

    if (entry.isDirectory()) {
      signals.add(`dir:${entry.name}`);
      if (["src", "app", "packages", "tests", "test"].includes(entry.name)) {
        signals.add(`project:${entry.name}`);
      }
      continue;
    }

    if (entry.isFile()) {
      if (["package.json", "tsconfig.json", "bunfig.toml", "vite.config.ts", "next.config.js"].includes(entry.name)) {
        signals.add(`file:${entry.name}`);
      }
    }
  }

  return [...signals].sort();
}

function inferRecommendedStack(packageMetadata: { packageManager: PackageManager; scripts: Record<string, string> } | undefined, signals: readonly string[]): string {
  if (signals.includes("file:package.json") || signals.includes("file:tsconfig.json") || packageMetadata?.packageManager === "bun") {
    return "Bun + TypeScript";
  }

  return "TypeScript";
}

function createVerificationCommandQuestion(commands: readonly VerificationCommand[]): GrillMeQuestion {
  return {
    id: verifyCommandQuestionId,
    requirement_ids: commands.map((command) => `verification-${command.kind}`),
    prompt: "Do you approve persisting discovered verification commands into .planning/config.json?",
    options: [
      {
        id: "approve-discovered-commands",
        text: "Approve and persist discovered verification commands",
        recommended: true,
      },
      {
        id: "skip-discovered-commands",
        text: "Do not persist discovered verification commands yet",
        recommended: false,
      },
    ],
    custom_answer: {
      enabled: true,
      label: "Optional notes or command edits",
    },
  };
}

function resolveVerificationCommandApproval(question: GrillMeQuestion, answer: GrillMeQuestionAnswer): boolean {
  validateGrillMeQuestionAnswer(answer);

  if (answer.question.id !== question.id) {
    return false;
  }

  return answer.selected_recommended_option?.id === "approve-discovered-commands";
}
