import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import { loadPhasekitConfig } from "../config/loader";
import { discoverVerificationCommands, type PackageManager } from "../verify/commands";
import { readJsonFile } from "../state/json";
import { projectStateSchema } from "../state/schema";
import {
  docsTaskSchema,
  docsWriterContextSchema,
  validateDocsFactualityResult,
  validateDocsTaskFactReferences,
  validateGeneratedDocDraftCitations,
  type DocsFactSource,
  type DocsFactualityVerificationResult,
  type DocsTask,
  type DocsWriter,
  type DocsWriterContext,
  type GeneratedDocDraft,
} from "./index";

const phasekitCommandNames = ["pk-init", "pk-status", "pk-next", "pk-config", "pk-ingest", "pk-add-phase", "pk-run-phase", "pk-verify"] as const;
const ignoredDirectoryNames = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".turbo", ".cache"]);
const ignoredPlanningNames = new Set(["cache", "tmp", "locks", "runs", "verifications"]);

export type DocsFactualityVerifier = (input: {
  task: DocsTask;
  factSources: readonly DocsFactSource[];
  context: DocsWriterContext;
  draft: GeneratedDocDraft;
}) => Promise<DocsFactualityVerificationResult> | DocsFactualityVerificationResult;

export interface GenerateDocumentationOptions {
  rootDir: string;
  task: DocsTask;
  writer: DocsWriter;
  factualityVerifier?: DocsFactualityVerifier;
  writeOutput?: boolean;
}

export interface GenerateDocumentationResult {
  task: DocsTask;
  fact_sources: readonly DocsFactSource[];
  context: DocsWriterContext;
  draft: GeneratedDocDraft;
  factuality?: DocsFactualityVerificationResult;
  output_path?: string;
  output_markdown?: string;
  wrote_output: boolean;
}

export async function collectDocsFactSources(rootDir: string): Promise<DocsFactSource[]> {
  const [project, config, packageMetadata, projectStructure] = await Promise.all([
    readJsonFile(join(rootDir, ".planning", "project.json"), projectStateSchema),
    loadPhasekitConfig({ projectRoot: rootDir }),
    readPackageMetadata(rootDir),
    collectProjectStructure(rootDir, rootDir),
  ]);
  const factSources: DocsFactSource[] = [];

  for (const commandName of phasekitCommandNames) {
    factSources.push({
      id: `command-${commandName}`,
      kind: "command",
      summary: `Phasekit command /${commandName}.`,
      value: `/${commandName}`,
      path: `.config/opencode/commands/${commandName}.md`,
    });
  }

  const verificationCommands = discoverVerificationCommands({
    config: config.verification,
    packageMetadata: packageMetadata ? [packageMetadata] : [],
  });

  for (const command of verificationCommands) {
    factSources.push({
      id: `command-verify-${command.kind}`,
      kind: "command",
      summary: `Verification command for ${command.kind}.`,
      value: command.command,
      path: command.source === "configured" ? ".planning/config.json" : "package.json",
    });
  }

  for (const entry of projectStructure) {
    factSources.push({
      id: `${entry.kind}-${toFactSourceSlug(entry.path)}`,
      kind: entry.kind,
      summary: `${entry.kind === "file" ? "Project file" : "Project structure"} ${entry.path}.`,
      value: entry.path,
      ...(entry.kind === "file" ? { path: entry.path } : {}),
    });
  }

  for (const configKey of flattenConfigKeys(config)) {
    factSources.push({
      id: `config-${toFactSourceSlug(configKey.key)}`,
      kind: "config_key",
      summary: `Effective config key ${configKey.key}.`,
      value: configKey.key,
      path: ".planning/config.json",
    });
  }

  if (typeof project.stack === "string" && project.stack.trim() !== "") {
    factSources.push({
      id: "confirmed-stack",
      kind: "confirmed_stack",
      summary: "Confirmed project stack.",
      value: project.stack.trim(),
      path: ".planning/project.json",
    });
  }

  return dedupeFactSources(factSources);
}

export async function generateDocumentation(options: GenerateDocumentationOptions): Promise<GenerateDocumentationResult> {
  const task = docsTaskSchema.parse(options.task);
  const factSources = await collectDocsFactSources(options.rootDir);
  validateDocsTaskFactReferences(task, factSources);

  const context = docsWriterContextSchema.parse({
    task,
    fact_sources: factSources,
    project_structure: factSources.filter((fact) => fact.kind === "project_structure" || fact.kind === "file").map((fact) => fact.value),
    commands: factSources.filter((fact) => fact.kind === "command").map((fact) => fact.value),
    config_keys: factSources.filter((fact) => fact.kind === "config_key").map((fact) => fact.value),
    confirmed_stack: factSources.find((fact) => fact.kind === "confirmed_stack")?.value,
  });
  const draft = validateGeneratedDocDraftCitations(await options.writer(context), factSources, task);
  const factuality = options.factualityVerifier
    ? validateDocsFactualityResult(await options.factualityVerifier({ task, factSources, context, draft }), { factSources, draft })
    : undefined;
  const outputPathValue = typeof task.output_path === "string" && task.output_path.trim() !== ""
    ? task.output_path
    : undefined;
  const shouldWriteOutput = options.writeOutput === true && outputPathValue !== undefined;
  const outputPath = outputPathValue ? join(options.rootDir, ...outputPathValue.split("/")) : undefined;
  const outputMarkdown = shouldWriteOutput ? renderGeneratedDocMarkdown(draft) : undefined;

  if (outputPath && outputMarkdown !== undefined) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, outputMarkdown, "utf8");
  }

  return {
    task,
    fact_sources: factSources,
    context,
    draft,
    factuality,
    output_path: outputPath ? toRelativePath(options.rootDir, outputPath) : undefined,
    output_markdown: outputMarkdown,
    wrote_output: outputPath !== undefined,
  };
}

function renderGeneratedDocMarkdown(draft: GeneratedDocDraft): string {
  return [
    `# ${draft.title}`,
    "",
    ...draft.sections.flatMap((section) => [
      `## ${section.heading}`,
      "",
      section.body,
      "",
    ]),
  ].join("\n");
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
            : "npm";

    return { packageManager, scripts: pkg.scripts ?? {} };
  } catch {
    return undefined;
  }
}

async function collectProjectStructure(rootDir: string, currentDir: string): Promise<Array<{ kind: "project_structure" | "file"; path: string }>> {
  const entries = (await readdir(currentDir, { withFileTypes: true }))
    .slice()
    .sort((left, right) => compareStrings(left.name, right.name));
  const structure: Array<{ kind: "project_structure" | "file"; path: string }> = [];

  for (const entry of entries) {
    const entryPath = join(currentDir, entry.name);
    const relativePath = toRelativePath(rootDir, entryPath);

    if (entry.isDirectory()) {
      if (shouldIgnoreDirectory(relativePath)) {
        continue;
      }

      structure.push({ kind: "project_structure", path: relativePath });
      structure.push(...await collectProjectStructure(rootDir, entryPath));
      continue;
    }

    structure.push({ kind: "file", path: relativePath });
  }

  return structure;
}

function flattenConfigKeys(value: unknown, prefix = ""): Array<{ key: string; value: unknown }> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return prefix === "" ? [] : [{ key: prefix, value }];
  }

  return Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compareStrings(left, right))
    .flatMap(([key, childValue]) => {
      const nextPrefix = prefix === "" ? key : `${prefix}.${key}`;
      return flattenConfigKeys(childValue, nextPrefix);
    });
}

function dedupeFactSources(factSources: readonly DocsFactSource[]): DocsFactSource[] {
  const byId = new Map<string, DocsFactSource>();

  for (const factSource of factSources) {
    byId.set(factSource.id, factSource);
  }

  return [...byId.values()].sort((left, right) => compareStrings(left.id, right.id));
}

function toFactSourceSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "fact";
}

function shouldIgnoreDirectory(relativePath: string): boolean {
  const segments = relativePath.split("/").filter(Boolean);

  if (segments.some((segment) => ignoredDirectoryNames.has(segment))) {
    return true;
  }

  const planningIndex = segments.indexOf(".planning");
  const planningChild = planningIndex === -1 ? undefined : segments[planningIndex + 1];
  return planningChild !== undefined && ignoredPlanningNames.has(planningChild);
}

function toRelativePath(rootDir: string, absolutePath: string): string {
  return relative(rootDir, absolutePath).split(sep).join("/");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
